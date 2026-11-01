-- Existing installations: run this entire file in Supabase SQL Editor.
-- Preserves holdings and balances; rejects sales without sufficient owned shares.
begin;

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

notify pgrst, 'reload schema';
commit;
