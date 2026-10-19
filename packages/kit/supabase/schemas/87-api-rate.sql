-- ---------------------------------------------------------------------------------------------
-- THE API'S RATE LIMIT, WHERE EVERY ISOLATE CAN SEE IT.
--
-- It used to be a Map in module scope. That is per ISOLATE, and the edge runtime runs as many as
-- it likes — so the door promised 78 requests a second in its own headers and actually allowed
-- 78 times however many workers happened to be up. It was not a limit; it was a limit-shaped
-- object. Nobody noticed because one isolate usually served a burst on a quiet local machine, and
-- the test that checked it passed for that reason rather than for the right one.
--
-- A counter everybody shares has to be in the one place everybody shares, which is here. The cost
-- is a statement per request on a door that is already reading the database, and the benefit is
-- that the number in the header is true.
--
-- ONE STATEMENT, NEVER READ-THEN-WRITE. Two requests that both read 77 and both write 78 have let
-- 79 through. The upsert below increments and returns the new value in the same statement, so the
-- count a caller is told is the count it caused.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."api_rate" (
    -- who is being counted: a key's id, or an address where there is no key
    "who" "text" NOT NULL,
    -- 'second' or 'hour' — two windows, one table, so one statement can take both
    "span" "text" NOT NULL,
    -- the window this count belongs to, truncated: a new window is simply a new row
    "started" timestamp with time zone NOT NULL,
    "n" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "api_rate_span_check" CHECK (("span" = ANY (ARRAY['second'::"text", 'hour'::"text"])))
);
ALTER TABLE ONLY "public"."api_rate" ADD CONSTRAINT "api_rate_pkey" PRIMARY KEY ("who", "span", "started");
CREATE INDEX IF NOT EXISTS "api_rate_started_idx" ON "public"."api_rate" USING "btree" ("started");

-- nothing but the doors, which hold the service role. A client that could read this could learn
-- which keys are busy; a client that could write it could hand itself a fresh allowance.
ALTER TABLE "public"."api_rate" ENABLE ROW LEVEL SECURITY;
-- the platform grants a new public table to anon and authenticated by default; RLS with no policy
-- already refuses them every row, and taking the grant back says so in the declaration as well
REVOKE ALL ON TABLE "public"."api_rate" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."api_rate" TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- TAKE ONE, AND SAY WHERE THAT LEAVES YOU. Both windows in one round trip: the door asks once per
-- request and gets back what it needs for the headers and for the refusal.
-- ---------------------------------------------------------------------------------------------
-- The instant is a PARAMETER, defaulting to now(). A sliding window measured against the wall
-- clock can only be tested by racing it: taking eighty in a loop over a network takes longer
-- than the second it is meant to be measuring, the window slides, and nothing is ever refused —
-- which is correct behaviour and an untestable assertion. With the instant given, the
-- arithmetic can be evaluated at a chosen moment and the test asserts the RULE rather than the
-- machine. Nothing in the running system passes it.
CREATE OR REPLACE FUNCTION "public"."api_rate_take"("p_who" "text", "p_now" timestamp with time zone DEFAULT NULL)
RETURNS TABLE("sec" integer, "hr" integer)
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s integer; h integer; prev integer; frac numeric; t timestamptz;
begin
  t := coalesce(p_now, now());
  insert into public.api_rate (who, span, started, n)
       values (p_who, 'second', date_trunc('second', t), 1)
  on conflict (who, span, started) do update set n = public.api_rate.n + 1
    returning public.api_rate.n into s;

  -- A SLIDING WINDOW, NOT A CALENDAR SECOND. A plain bucket per clock second lets 156 requests
  -- through across a boundary — 78 at .999 and 78 at .001 — and, the other way, splits a genuine
  -- burst so that neither half reaches the limit and nothing is refused at all. The second is
  -- what the header promises, so the second is what has to be measured.
  --
  -- This was written as `1 - extract(milliseconds from now()) / 1000` and was wrong for every
  -- second but the first of each minute: extract(milliseconds) is the SECONDS field times a
  -- thousand PLUS the milliseconds — 1400 at :01.400, not 400 — so the fraction went negative
  -- and the window SUBTRACTED the previous second’s count instead of carrying part of it. It
  -- survived because the only test of it raced the wall clock, which is why the instant is now
  -- a parameter: a sliding window can only be checked at a moment somebody chose.
  --
  -- The standard approximation, and it is two rows rather than a scan: take the previous
  -- second's count and carry the part of it still inside the trailing second.
  select coalesce(n, 0) into prev from public.api_rate
   where who = p_who and span = 'second' and started = date_trunc('second', t) - interval '1 second';
  frac := 1 - extract(epoch from (t - date_trunc('second', t)));
  s := ceil(s + coalesce(prev, 0) * frac);

  insert into public.api_rate (who, span, started, n)
       values (p_who, 'hour', date_trunc('hour', t), 1)
  on conflict (who, span, started) do update set n = public.api_rate.n + 1
    returning public.api_rate.n into h;

  return query select s, h;
end;
$$;
REVOKE ALL ON FUNCTION "public"."api_rate_take"("text", timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."api_rate_take"("text", timestamp with time zone) FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."api_rate_take"("text", timestamp with time zone) TO "service_role";

-- ---------------------------------------------------------------------------------------------
-- AND SWEEP. A window that has passed counts nothing, so the rows are litter rather than state:
-- an hour's worth is kept so a debugging look at "who is hammering us" has something to read.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."api_rate_sweep"() RETURNS void
    LANGUAGE "sql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  delete from public.api_rate where started < now() - interval '2 hours'
$$;
REVOKE ALL ON FUNCTION "public"."api_rate_sweep"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."api_rate_sweep"() FROM "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."api_rate_sweep"() TO "service_role";
