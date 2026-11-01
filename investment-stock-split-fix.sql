-- Existing installations: run after all previously applied investment SQL updates.
-- Exact decimal prices and unbounded numeric share counts prevent split overflow
-- while keeping quantity * price unchanged by every power-of-ten split.
begin;

create temporary table investment_stock_split_saved_triggers (
  trigger_name text primary key,
  trigger_definition text not null,
  trigger_enabled char not null
) on commit drop;

do $$
declare
  trigger_row record;
begin
  for trigger_row in
    select t.tgname, pg_get_triggerdef(t.oid, true) as definition, t.tgenabled
    from pg_trigger t
    join pg_attribute a
      on a.attrelid = t.tgrelid and a.attname = 'current_price' and not a.attisdropped
    join pg_depend d
      on d.classid = 'pg_trigger'::regclass
      and d.objid = t.oid
      and d.refclassid = 'pg_class'::regclass
      and d.refobjid = t.tgrelid
      and d.refobjsubid = a.attnum
    where t.tgrelid = 'public.investment_assets'::regclass
      and not t.tgisinternal
  loop
    insert into investment_stock_split_saved_triggers
      (trigger_name, trigger_definition, trigger_enabled)
    values (trigger_row.tgname, trigger_row.definition, trigger_row.tgenabled);
    execute format('drop trigger %I on public.investment_assets', trigger_row.tgname);
  end loop;
end;
$$;

alter table public.investment_assets
  add column if not exists split_notice boolean not null default false;
alter table public.investment_assets
  add column if not exists was_delisted boolean not null default false;
alter table public.investment_assets
  add column if not exists delisted_at timestamptz;

alter table public.investment_assets
  alter column current_price type numeric using current_price::numeric;
alter table public.investment_holdings
  alter column quantity type numeric using quantity::numeric;

do $$
declare
  trigger_row record;
begin
  for trigger_row in
    select trigger_name, trigger_definition, trigger_enabled
    from investment_stock_split_saved_triggers
  loop
    execute trigger_row.trigger_definition;
    if trigger_row.trigger_enabled = 'D' then
      execute format('alter table public.investment_assets disable trigger %I', trigger_row.trigger_name);
    elsif trigger_row.trigger_enabled = 'R' then
      execute format('alter table public.investment_assets enable replica trigger %I', trigger_row.trigger_name);
    elsif trigger_row.trigger_enabled = 'A' then
      execute format('alter table public.investment_assets enable always trigger %I', trigger_row.trigger_name);
    end if;
  end loop;
end;
$$;

update public.investment_holdings h
set invested_amount = least(
  9223372036854775807::numeric,
  round(h.quantity * a.current_price)
)::bigint
from public.investment_assets a
where h.symbol = a.symbol and h.quantity > 0 and h.invested_amount = 0;

create or replace function public.investment_build_state(p_client_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nickname', u.nickname,
    'cash', u.cash,
    'cash_exact', u.cash::text,
    'total_asset', u.cash + coalesce((
      select sum(h.quantity * a.current_price)
      from public.investment_holdings h
      join public.investment_assets a on a.symbol = h.symbol
      where h.client_id = u.client_id and a.listed
    ), 0),
    'total_asset_exact', (
      u.cash + coalesce((
        select sum(h.quantity * a.current_price)
        from public.investment_holdings h
        join public.investment_assets a on a.symbol = h.symbol
        where h.client_id = u.client_id and a.listed
      ), 0)
    )::text,
    'market_date', (select last_market_date from public.investment_market where id = 1),
    'assets', coalesce((
      select jsonb_agg(
        jsonb_set(to_jsonb(a), '{current_price_exact}', to_jsonb(a.current_price::text))
        order by a.symbol
      )
      from public.investment_assets a
    ), '[]'::jsonb),
    'holdings', coalesce((
      select jsonb_agg(
        jsonb_set(
          jsonb_set(to_jsonb(h), '{quantity_exact}', to_jsonb(h.quantity::text)),
          '{invested_amount_exact}', to_jsonb(h.invested_amount::text)
        )
        order by h.symbol
      )
      from public.investment_holdings h
      where h.client_id = u.client_id
    ), '[]'::jsonb),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', r.client_id,
        'nickname', r.nickname,
        'player_level', r.player_level,
        'total_asset', r.total_asset,
        'total_asset_exact', r.total_asset::text
      ) order by r.total_asset desc)
      from (
        select iu.client_id, iu.nickname, coalesce(sgs.player_level, 0) as player_level,
          iu.cash + coalesce((
            select sum(ih.quantity * ia.current_price)
            from public.investment_holdings ih
            join public.investment_assets ia on ia.symbol = ih.symbol
            where ih.client_id = iu.client_id and ia.listed
          ), 0) as total_asset
        from public.investment_users iu
        left join public.sanggi_game_states sgs on sgs.account_id = iu.client_id
      ) r
    ), '[]'::jsonb)
  )
  from public.investment_users u
  where u.client_id = p_client_id;
$$;

drop function if exists public.investment_trade(uuid, text, text, integer);
drop function if exists public.investment_trade(uuid, text, text, bigint);

create or replace function public.investment_trade(
  p_client_id uuid,
  p_symbol text,
  p_side text,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row public.investment_users%rowtype;
  asset_row public.investment_assets%rowtype;
  current_quantity numeric;
  current_invested bigint;
  total_price bigint;
  exact_total_price numeric;
begin
  perform public.investment_update_market();
  select * into user_row from public.investment_users where client_id = p_client_id for update;
  if user_row.client_id is null then raise exception '먼저 닉네임을 설정하세요.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception '수량은 1주 이상이어야 합니다.'; end if;
  if p_quantity <> trunc(p_quantity) then raise exception '수량은 정수로 입력하세요.'; end if;
  if p_side not in ('buy', 'sell') then raise exception '잘못된 거래 유형입니다.'; end if;
  select * into asset_row from public.investment_assets where symbol = p_symbol for update;
  if asset_row.symbol is null or not asset_row.listed then raise exception '현재 거래할 수 없는 상품입니다.'; end if;
  exact_total_price := case
    when p_side = 'buy' then ceil(asset_row.current_price * p_quantity::numeric)
    else floor(asset_row.current_price * p_quantity::numeric)
  end;
  if exact_total_price > 9223372036854775807 then
    raise exception '거래 금액이 너무 큽니다.';
  end if;
  total_price := exact_total_price::bigint;
  select coalesce(quantity, 0), coalesce(invested_amount, 0)
  into current_quantity, current_invested
  from public.investment_holdings
  where client_id = p_client_id and symbol = p_symbol
  for update;
  current_quantity := coalesce(current_quantity, 0);
  current_invested := coalesce(current_invested, 0);

  if p_side = 'buy' then
    if user_row.cash < total_price then raise exception '보유 현금이 부족합니다.'; end if;
    if (current_invested::numeric + total_price::numeric) > 9223372036854775807 then
      raise exception '투자 금액이 너무 큽니다.';
    end if;
    update public.investment_users set cash = cash - total_price where client_id = p_client_id;
    insert into public.investment_holdings (client_id, symbol, quantity, invested_amount)
    values (p_client_id, p_symbol, p_quantity, total_price)
    on conflict (client_id, symbol) do update
    set quantity = public.investment_holdings.quantity + excluded.quantity,
        invested_amount = public.investment_holdings.invested_amount + excluded.invested_amount;
  elsif p_side = 'sell' then
    if current_quantity < p_quantity then raise exception '보유 주식보다 많이 팔 수 없습니다.'; end if;
    if (user_row.cash::numeric + total_price::numeric) > 9223372036854775807 then
      raise exception '거래 후 현금이 너무 큽니다.';
    end if;
    update public.investment_holdings
    set quantity = quantity - p_quantity,
        invested_amount = case
          when p_quantity = current_quantity then 0
          else invested_amount - round(invested_amount * p_quantity::numeric / current_quantity)
        end
    where client_id = p_client_id and symbol = p_symbol and quantity >= p_quantity;
    if not found then raise exception '보유 주식보다 많이 팔 수 없습니다.'; end if;
    update public.investment_users set cash = cash + total_price where client_id = p_client_id;
  end if;
  return public.investment_build_state(p_client_id);
end;
$$;
revoke all on function public.investment_trade(uuid, text, text, numeric) from public;
grant execute on function public.investment_trade(uuid, text, text, numeric) to anon;

create or replace function public.investment_admin_split_asset(
  p_admin_password text,
  p_symbol text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_price numeric;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;
  select current_price into v_current_price
  from public.investment_assets where symbol = p_symbol for update;
  if not found then raise exception '액면분할할 종목을 찾을 수 없습니다.'; end if;
  perform set_config('app.investment_admin_reset', 'on', true);
  update public.investment_holdings set quantity = quantity * 1000 where symbol = p_symbol;
  update public.investment_assets
  set current_price = current_price / 1000, change_pct = 0, split_notice = true
  where symbol = p_symbol;
  perform set_config('app.investment_admin_reset', 'off', true);
  return true;
end;
$$;

create or replace function public.investment_apply_stock_splits()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_row record;
  v_split_factor bigint;
  v_previous_admin_reset text;
begin
  v_previous_admin_reset := current_setting('app.investment_admin_reset', true);
  perform set_config('app.investment_admin_reset', 'on', true);
  for asset_row in
    select symbol, current_price
    from public.investment_assets
    where listed = true and (
      (symbol in ('SURGE_STOCK', 'CURRENT_SURGE_STOCK', 'DONGHWA_SURGE_STOCK',
        'JEONGMIN_SURGE_STOCK', 'JUSEONG_SURGE_STOCK', 'JAEJJING_SURGE_STOCK')
        and current_price >= 1000000)
      or (symbol in ('SANGI_ROCKET', 'JEONGMIN_ROCKET', 'SANGI_BIO')
        and current_price > 1000000)
      or (symbol in ('SEOK_HYNIX', 'SAMSUNG_MICROWAVE') and current_price > 10000000)
      or (symbol not in ('SURGE_STOCK', 'CURRENT_SURGE_STOCK', 'DONGHWA_SURGE_STOCK',
        'JEONGMIN_SURGE_STOCK', 'JUSEONG_SURGE_STOCK', 'JAEJJING_SURGE_STOCK',
        'SANGI_ROCKET', 'JEONGMIN_ROCKET', 'SANGI_BIO', 'SEOK_HYNIX', 'SAMSUNG_MICROWAVE')
        and current_price > 1000000)
    )
    for update
  loop
    if asset_row.symbol in ('SURGE_STOCK', 'CURRENT_SURGE_STOCK', 'DONGHWA_SURGE_STOCK',
      'JEONGMIN_SURGE_STOCK', 'JUSEONG_SURGE_STOCK', 'JAEJJING_SURGE_STOCK') then
      v_split_factor := 1000;
    elsif asset_row.symbol in ('SEOK_HYNIX', 'SAMSUNG_MICROWAVE') then
      v_split_factor := 10;
    else
      v_split_factor := 100;
    end if;
    if v_split_factor = 1000 then
      insert into public.investment_shop_messages(client_id, message)
      select h.client_id,
        '보유하고 있던 ' || a.name || ' 종목이 1주당 1,000주로 분할되었습니다. 보유 수량 '
          || h.quantity::text || '주 → ' || (h.quantity * v_split_factor)::text
          || '주, 주가는 ' || trim_scale(asset_row.current_price)::text
          || '원 → ' || trim_scale(asset_row.current_price / v_split_factor)::text
          || '원으로 조정되었습니다.'
      from public.investment_holdings h
      join public.investment_assets a on a.symbol = h.symbol
      where h.symbol = asset_row.symbol and h.quantity > 0;
    end if;
    update public.investment_holdings
    set quantity = quantity * v_split_factor
    where symbol = asset_row.symbol;
    update public.investment_assets
    set current_price = current_price / v_split_factor, split_notice = true
    where symbol = asset_row.symbol;
  end loop;
  perform set_config('app.investment_admin_reset', coalesce(v_previous_admin_reset, 'off'), true);
end;
$$;

revoke all on function public.investment_apply_stock_splits() from public;
grant execute on function public.investment_apply_stock_splits() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
