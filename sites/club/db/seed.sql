-- The club's member: the kit's seed makes the accounts and leaves the memberships to the site (its own tier) —
-- member@example.com on the member tier, exactly the rows the webhook writes for a live subscription, so a check
-- about what a member holds has a member to ask.
do $$
declare m uuid;
begin
  if exists (select 1 from public.entitlements where source_id = 'seed') then return; end if;
  select id into m from auth.users where email = 'member@example.com';
  if m is null then return; end if;
  insert into public.entitlements (user_id, kind, key, source, source_id, tier, plan_amount, expires_at)
  values (m, 'class', 'subscribed', 'grant', 'seed', 'member', 800, now() + interval '30 days');
end $$;
