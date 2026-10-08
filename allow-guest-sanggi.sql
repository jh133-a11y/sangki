create table if not exists public.sanggi_guest_states (
  client_id uuid primary key references public.investment_users(client_id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  player_level integer not null default 1 check (player_level >= 1),
  updated_at timestamptz not null default now()
);

alter table public.sanggi_guest_states enable row level security;
revoke all on table public.sanggi_guest_states from public, anon, authenticated;

create or replace function public.sanggi_sync_guest_state(
  p_client_id uuid,
  p_nickname text,
  p_coins bigint,
  p_player_level integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.sanggi_guest_states%rowtype;
begin
  if p_client_id is null or nullif(trim(p_nickname), '') is null then
    raise exception '투자 닉네임을 확인할 수 없습니다.';
  end if;
  if not exists (
    select 1 from public.investment_users
    where client_id = p_client_id and nickname = trim(p_nickname)
  ) then
    raise exception '투자자 ID와 닉네임이 일치하지 않습니다.';
  end if;
  if exists (select 1 from public.site_accounts where id = p_client_id) then
    raise exception '회원 게임 데이터에는 비회원 동기화를 사용할 수 없습니다.';
  end if;
  if p_coins is null or p_coins < 0 then
    raise exception '코인 값이 올바르지 않습니다.';
  end if;
  if p_player_level is null or p_player_level < 1 then
    raise exception '플레이어 레벨 값이 올바르지 않습니다.';
  end if;

  insert into public.sanggi_guest_states (client_id, coins, player_level, updated_at)
  values (p_client_id, p_coins, p_player_level, now())
  on conflict (client_id) do update set
    coins = excluded.coins,
    player_level = excluded.player_level,
    updated_at = now()
  returning * into v_state;

  return jsonb_build_object(
    'coins', v_state.coins::text,
    'player_level', v_state.player_level
  );
end;
$$;

create or replace function public.shop_purchase_guest_coin_box(
  p_client_id uuid,
  p_nickname text,
  p_item_type text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price bigint;
  v_name text;
  v_coins bigint;
  v_owned_quantity bigint;
begin
  if p_item_type = 'cash_box' then
    v_price := 500000;
    v_name := '랜덤 현금 박스';
  elsif p_item_type = 'weird_cash_box' then
    v_price := 100000;
    v_name := '이상한 랜덤 현금 박스';
  else
    raise exception '존재하지 않는 코인 상점 상품입니다.';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception '구매 수량은 1개 이상 100개 이하로 입력하세요.';
  end if;
  if not exists (
    select 1 from public.investment_users
    where client_id = p_client_id and nickname = trim(p_nickname)
  ) then
    raise exception '투자자 ID와 닉네임이 일치하지 않습니다.';
  end if;
  if exists (select 1 from public.site_accounts where id = p_client_id) then
    raise exception '회원 게임 데이터에는 비회원 구매를 사용할 수 없습니다.';
  end if;

  select coins into v_coins
  from public.sanggi_guest_states
  where client_id = p_client_id
  for update;
  if v_coins is null then
    raise exception '상기 키우기 정보를 먼저 동기화하세요.';
  end if;

  insert into public.investment_shop_items(client_id, item_type, quantity)
  values (p_client_id, p_item_type, 0)
  on conflict (client_id, item_type) do nothing;

  select quantity into v_owned_quantity
  from public.investment_shop_items
  where client_id = p_client_id and item_type = p_item_type
  for update;
  if coalesce(v_owned_quantity, 0) + p_quantity > 100 then
    raise exception '상자는 한 종류당 최대 100개까지 보유할 수 있습니다.';
  end if;
  if v_coins < v_price * p_quantity then
    raise exception '보유 코인이 부족합니다.';
  end if;

  update public.sanggi_guest_states
  set coins = coins - v_price * p_quantity,
      updated_at = now()
  where client_id = p_client_id
  returning coins into v_coins;

  update public.investment_shop_items
  set quantity = quantity + p_quantity
  where client_id = p_client_id and item_type = p_item_type;

  return jsonb_build_object(
    'message', v_name || ' ' || p_quantity || '개를 구매했습니다.',
    'coins', v_coins::text,
    'quantity', coalesce(v_owned_quantity, 0) + p_quantity
  );
end;
$$;

create or replace function public.sanggi_get_public_player_ranking()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'nickname', u.nickname,
      'player_level', coalesce(s.player_level, g.player_level, 1)
    )
    order by coalesce(s.player_level, g.player_level, 1) desc, u.nickname asc
  ), '[]'::jsonb)
  from public.investment_users u
  left join public.sanggi_game_states s on s.account_id = u.client_id
  left join public.sanggi_guest_states g on g.client_id = u.client_id
  where s.account_id is not null or g.client_id is not null;
$$;

revoke all on function public.sanggi_sync_guest_state(uuid, text, bigint, integer) from public;
revoke all on function public.shop_purchase_guest_coin_box(uuid, text, text, bigint) from public;
revoke all on function public.sanggi_get_public_player_ranking() from public;
grant execute on function public.sanggi_sync_guest_state(uuid, text, bigint, integer) to anon, authenticated;
grant execute on function public.shop_purchase_guest_coin_box(uuid, text, text, bigint) to anon, authenticated;
grant execute on function public.sanggi_get_public_player_ranking() to anon, authenticated;

notify pgrst, 'reload schema';
