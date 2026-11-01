-- the store's rows: its orders and their transactions in the provider-scoped payment index, and the
-- fulfilments carried onto the generic slot
-- Rows, not schema: idempotent, run whole on every plan and every reset after the kit's data.sql, and assembled only
-- while the module is on (openspec: module-switch-removes-backend). Never a table or a policy.

-- the orders' Stripe ids, copied into the provider-scoped index beside the purchases' (data.sql)
insert into public.payment_provider_refs (provider, object_type, external_id, entity_type, entity_id)
select 'stripe', 'checkout', o.checkout_session, 'orders', o.id::text
  from public.orders o
 where position(':' in o.checkout_session) = 0 and nullif(btrim(o.checkout_session), '') is not null
union all
select 'stripe',
       case t.reason when 'refund' then 'refund' when 'chargeback' then 'chargeback' else 'payment' end,
       t.reference, 'order_transactions', t.id::text
  from public.order_transactions t
 where t.reason <> 'credit' and position(':' in t.reference) = 0 and nullif(btrim(t.reference), '') is not null
on conflict do nothing;

-- WHAT A BOOK'S KIND DERIVED, OFF PRINT'S OWN COLUMNS AND ONTO THE GENERIC SLOT.
-- fulfilments carried book, edition, format, contents, cloth and foil beside `chosen`, which is
-- the slot every other kind writes; that is what made the table a print_orders with a wider name.
-- Nothing reads them now. They cannot be dropped in the same deploy as this backfill — the plan is
-- renames, then the diff, then this script, so a drop would run BEFORE the rows were carried over
-- — so they are dropped in the deploy after the one that runs this.
-- A row whose variant was never written (every row made before the store sold anything but books)
-- is the reason this exists rather than deriving from the variant at read time.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'fulfilments' and column_name = 'book') then
    execute $q$
      update public.fulfilments f set chosen = jsonb_strip_nulls(jsonb_build_object(
               'book', f.book, 'edition', f.edition, 'format', f.format,
               'contents', f.contents, 'cloth', f.cloth, 'foil', f.foil))
       where f.chosen is null and f.book is not null
    $q$;
    execute $q$
      update public.fulfilments f
         set variant = concat_ws('.', nullif(f.contents, ''), nullif(f.cloth, ''), nullif(f.foil, ''))
       where coalesce(f.variant, '') = '' and nullif(f.contents, '') is not null
    $q$;
  end if;
end $$;
