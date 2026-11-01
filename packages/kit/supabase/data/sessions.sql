-- the sessions' rows: their bookings, checkouts and payout accounts in the provider-scoped payment
-- index, the holds every booking keeps, and the hours carried across
-- Rows, not schema: idempotent, run whole on every plan and every reset after the kit's data.sql, and assembled only
-- while the module is on (openspec: module-switch-removes-backend). Never a table or a policy.

-- a booking's checkout keeps its historical Stripe id as its identity, as a purchase's does (data.sql)
update public.bookings
   set checkout_identity = stripe_checkout_session_id
 where checkout_identity is null and nullif(btrim(stripe_checkout_session_id), '') is not null;

-- the bookings', checkouts' and payout accounts' ids, copied into the provider-scoped index beside the purchases' (data.sql)
insert into public.payment_provider_refs (provider, object_type, external_id, entity_type, entity_id)
select 'stripe', 'checkout', b.stripe_checkout_session_id, 'bookings', b.uid
  from public.bookings b
 where nullif(btrim(b.stripe_checkout_session_id), '') is not null
union all
select 'stripe', 'checkout', f.checkout_session_id, 'booking_checkout_fulfilments', f.checkout_session_id
  from public.booking_checkout_fulfilments f
 where position(':' in f.checkout_session_id) = 0 and nullif(btrim(f.checkout_session_id), '') is not null
union all
select a.provider, 'payout_account', a.account_id, 'payout_accounts', a.user_id::text
  from public.payout_accounts a
 where nullif(btrim(a.account_id), '') is not null
on conflict do nothing;

-- EVERY BOOKING THAT ALREADY HOLDS A TIME gets the row that now says so. Idempotent: a hold the
-- booking already has is left alone, and a group's hold is written once, on its first seat.
insert into public.booking_holds (booking_uid, user_id, start_at, end_at)
select coalesce(b.seat_of, b.uid), b.host_id, b.start_at, b.end_at
  from public.bookings b
 where b.provider = 'native' and b.status in ('accepted', 'pending')
   and b.host_id is not null and b.start_at is not null and b.end_at is not null
   and (b.seat_of is null or b.seat_of = b.uid)
   /* a host whose account has gone holds nothing — the booking keeps their id for the record, but
      there is no longer a person whose time could be taken twice */
   and exists (select 1 from public.profiles p where p.id = b.host_id)
   and not exists (select 1 from public.booking_holds h
                    where h.booking_uid = coalesce(b.seat_of, b.uid) and h.user_id = b.host_id)
on conflict do nothing;

-- ONE BUFFER BECAME TWO, and the old one meant both sides: `openStarts` widened a busy interval by
-- it before AND after, so copying it into `buffer_before` alone would quietly halve everybody's
-- breathing room. It is copied across once — guarded by a marker rather than by "where it is still
-- zero", because somebody who deliberately wants nothing after a call must be able to say so.
do $$
begin
  if not exists (select 1 from public.app_settings where key = 'buffers_split') then
    update public.provider_schedules set buffer_after = buffer_before where buffer_before > 0;
    insert into public.app_settings (key, value) values ('buffers_split', '1')
    on conflict (key) do nothing;
  end if;
end $$;

-- every set of hours has a name and one of them is the default; a person who kept hours before there
-- was more than one set keeps them as their default, called what cal.com calls it
update public.provider_schedules set name = 'Working hours' where coalesce(btrim(name), '') = '';
update public.provider_schedules s set is_default = true
 where not exists (select 1 from public.provider_schedules d where d.user_id = s.user_id and d.is_default);

-- an override written before there was more than one set of hours belongs to the default one
update public.provider_overrides o set schedule_id = s.id
  from public.provider_schedules s
 where o.schedule_id is null and s.user_id = o.user_id and s.is_default;
