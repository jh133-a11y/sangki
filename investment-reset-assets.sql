-- Run exactly once after applying the stock-split migration.
-- Removes investment holdings and sets investment cash to 5,000,000.
-- Other game assets, shop inventory, and account rows are not changed.
begin;

create table if not exists public.investment_one_time_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);
revoke all on table public.investment_one_time_migrations from public, anon, authenticated;

lock table public.investment_holdings, public.investment_users
  in access exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.investment_one_time_migrations
    where migration_key = 'reset_stock_assets_to_5000000_v1'
  ) then
    raise exception 'Stock asset reset was already applied; no changes made.';
  end if;

  delete from public.investment_holdings;
  update public.investment_users
  set cash = 5000000;

  insert into public.investment_one_time_migrations (migration_key)
  values ('reset_stock_assets_to_5000000_v1');
end;
$$;

notify pgrst, 'reload schema';
commit;
