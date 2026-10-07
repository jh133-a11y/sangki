create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  body text not null check (char_length(body) between 1 and 500),
  password_hash text not null check (char_length(password_hash) = 64),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

alter table public.comments add column if not exists edited_at timestamptz;
alter table public.comments add column if not exists parent_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comments_parent_id_fkey'
  ) then
    alter table public.comments
      add constraint comments_parent_id_fkey
      foreign key (parent_id) references public.comments(id) on delete cascade;
  end if;
end $$;

alter table public.comments enable row level security;

drop policy if exists "Anyone can read comments" on public.comments;
drop policy if exists "Anyone can add comments" on public.comments;

create policy "Anyone can read comments"
on public.comments for select
to anon
using (true);

create policy "Anyone can add comments"
on public.comments for insert
to anon
with check (true);

create or replace function public.update_comment(
  p_id uuid,
  p_password_hash text,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comments
  set body = trim(p_body), edited_at = now()
  where id = p_id
    and password_hash = p_password_hash
    and char_length(trim(p_body)) between 1 and 500;

  return found;
end;
$$;

drop function if exists public.delete_comment(uuid, text);
drop function if exists public.delete_comment(uuid, text, text);

create or replace function public.delete_comment(
  p_id uuid,
  p_password_hash text,
  p_admin_password text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.comments
  where id = p_id
    and (
      password_hash = p_password_hash
      or p_admin_password = '8170'
    );

  return found;
end;
$$;

revoke all on function public.update_comment(uuid, text, text) from public;
revoke all on function public.delete_comment(uuid, text, text) from public;
grant execute on function public.update_comment(uuid, text, text) to anon;
grant execute on function public.delete_comment(uuid, text, text) to anon;

drop function if exists public.delete_all_comments(text);

create table if not exists public.speed_game_scores (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  solved_count integer not null check (solved_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.speed_game_scores enable row level security;

drop policy if exists "Anyone can read speed game scores" on public.speed_game_scores;
drop policy if exists "Anyone can add speed game scores" on public.speed_game_scores;

create policy "Anyone can read speed game scores"
on public.speed_game_scores for select
to anon using (true);

create policy "Anyone can add speed game scores"
on public.speed_game_scores for insert
to anon with check (true);

drop function if exists public.delete_speed_game_score(uuid, text);

create or replace function public.delete_speed_game_score(
  p_id uuid,
  p_admin_password text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    return false;
  end if;

  delete from public.speed_game_scores
  where id = p_id;

  return found;
end;
$$;

revoke all on function public.delete_speed_game_score(uuid, text) from public;
grant execute on function public.delete_speed_game_score(uuid, text) to anon;

create table if not exists public.investment_market (
  id integer primary key check (id = 1),
  last_market_date date,
  direction_date date,
  direction_state jsonb not null default '{}'::jsonb,
  last_price_update timestamptz
);

alter table public.investment_market
  add column if not exists direction_date date;
alter table public.investment_market
  add column if not exists direction_state jsonb not null default '{}'::jsonb;
alter table public.investment_market
  add column if not exists last_price_update timestamptz;

create table if not exists public.investment_assets (
  symbol text primary key,
  name text not null,
  base_price bigint not null check (base_price > 0),
  current_price bigint not null check (current_price >= 0),
  change_pct numeric not null default 0,
  listed boolean not null default true
);

create or replace function public.investment_next_direction(
  p_previous_pct numeric,
  p_daily_direction integer
)
returns integer
language plpgsql
as $$
begin
  if p_previous_pct <= -10 and random() < 0.7 then
    return 1;
  end if;

  if p_previous_pct = 0 then
    return p_daily_direction;
  end if;

  if random() < 0.7 then
    return sign(p_previous_pct)::integer;
  end if;

  return -sign(p_previous_pct)::integer;
end;
$$;

create table if not exists public.investment_users (
  client_id uuid primary key,
  nickname text not null unique check (char_length(nickname) between 1 and 24),
  cash bigint not null default 500000 check (cash >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.investment_holdings (
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  symbol text not null references public.investment_assets(symbol),
  quantity integer not null default 0 check (quantity >= 0),
  invested_amount bigint not null default 0 check (invested_amount >= 0),
  primary key (client_id, symbol)
);

alter table public.investment_holdings
  add column if not exists invested_amount bigint not null default 0;

update public.investment_holdings h
set invested_amount = h.quantity * a.current_price
from public.investment_assets a
where h.symbol = a.symbol
  and h.quantity > 0
  and h.invested_amount = 0;

alter table public.investment_market enable row level security;
alter table public.investment_assets enable row level security;
alter table public.investment_users enable row level security;
alter table public.investment_holdings enable row level security;

insert into public.investment_assets (symbol, name, base_price, current_price)
values
  ('SANGI_ROCKET', '상기로켓', 10000, 10000),
  ('JEONGMIN_ROCKET', '정민로켓', 5000, 5000),
  ('SANGI_BIO', '상기바이오', 30000, 30000),
  ('SAMSUNG_MICROWAVE', '삼성전자레인지', 100000, 100000),
  ('SEOK_HYNIX', 'Seok하이닉스', 1500000, 1500000),
  ('KOREA_SANGI_INDEX', '한국상기지수', 20000, 20000),
  ('SURGE_STOCK', '급등주', 500, 500),
  ('CURRENT_SURGE_STOCK', '현재급등주', 3000, 3000),
  ('DONGHWA_SURGE_STOCK', '동화급등주', 2000, 2000),
  ('JEONGMIN_SURGE_STOCK', '정민급등주', 900, 900),
  ('JUSEONG_SURGE_STOCK', '주성급등주', 120000, 120000),
  ('SANGI_AI', '상기AI', 1000, 1000),
  ('QUANTUM_YOON', '양자윤석열', 50000, 50000)
on conflict (symbol) do nothing;

create or replace function public.investment_update_market()
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  kst_now timestamp := now() at time zone 'Asia/Seoul';
  today date := kst_now::date;
  current_bucket timestamptz :=
    date_trunc('hour', now())
    + make_interval(
        mins => (floor(extract(minute from now()) / 5) * 5)::integer
      );
  direction_date_value date;
  direction_state_value jsonb;
  asset record;
  pct numeric;
  pct_two numeric;
  previous_pct numeric;
  previous_pct_two numeric;
  daily_direction integer;
  movement_direction integer;
  step numeric;
  step_two numeric;
  min_pct numeric;
  max_pct numeric;
  next_price bigint;
  new_direction_day boolean := false;
begin
  insert into public.investment_market (id, last_market_date)
  values (1, null)
  on conflict (id) do nothing;

  select direction_date, direction_state
  into direction_date_value, direction_state_value
  from public.investment_market
  where id = 1
  for update;

  if kst_now::time < time '12:00'
     and direction_date_value is distinct from today then
    return coalesce(direction_date_value, today);
  end if;

  if direction_date_value is distinct from today then
    direction_state_value := jsonb_build_object(
      'SANGI_ROCKET', case when random() < 0.5 then -1 else 1 end,
      'JEONGMIN_ROCKET', 0,
      'SANGI_BIO', case when random() < 0.5 then -1 else 1 end,
      'SAMSUNG_MICROWAVE', case when random() < 0.5 then -1 else 1 end,
      'SEOK_HYNIX', 0,
      'KOREA_SANGI_INDEX', case when random() < 0.5 then -1 else 1 end,
      'SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'CURRENT_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'DONGHWA_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'JEONGMIN_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'JUSEONG_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'SANGI_AI', case when random() < 0.5 then -1 else 1 end,
      'QUANTUM_YOON', case when random() < 0.5 then -1 else 1 end,
      'rocket_event', random() < 0.10,
      'bio_event', random() < 0.05,
      'quantum_event', random() < 0.05,
      'tech_direction', case when random() < 0.5 then -1 else 1 end
    );
    direction_state_value := jsonb_set(
      direction_state_value,
      '{JEONGMIN_ROCKET}',
      direction_state_value->'SANGI_ROCKET'
    );
    direction_state_value := jsonb_set(
      direction_state_value,
      '{SEOK_HYNIX}',
      direction_state_value->'SAMSUNG_MICROWAVE'
    );
    update public.investment_market
    set direction_date = today,
        direction_state = direction_state_value,
        last_market_date = today,
        last_price_update = null
    where id = 1;
    new_direction_day := true;
  end if;

  select direction_state into direction_state_value
  from public.investment_market
  where id = 1;

  if not new_direction_day
     and (
       select last_price_update
       from public.investment_market
       where id = 1
     ) is not distinct from current_bucket then
    return today;
  end if;

  for asset in select * from public.investment_assets order by symbol for update loop
    if not asset.listed and not new_direction_day then
      continue;
    end if;

    if not asset.listed and new_direction_day then
      update public.investment_assets
      set current_price = base_price, change_pct = 0, listed = true
      where symbol = asset.symbol;
      asset.current_price := asset.base_price;
      asset.change_pct := 0;
    end if;

    if asset.symbol = 'JEONGMIN_ROCKET' then
      continue;
    end if;

    pct := 0;
    previous_pct := asset.change_pct;
    if asset.symbol in ('SANGI_ROCKET', 'JEONGMIN_ROCKET') then
      daily_direction := (direction_state_value->>'SANGI_ROCKET')::integer;
      min_pct := -30;
      max_pct := 30;
      if new_direction_day and (direction_state_value->>'rocket_event')::boolean
         and daily_direction > 0 then
        pct := floor(random() * 101) + 100;
        pct_two := floor(random() * 101) + 100;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 5) + 1;
        step_two := floor(random() * 5) + 1;
        pct := greatest(min_pct, least(max_pct, previous_pct + movement_direction * step));
        previous_pct_two := (
          select change_pct from public.investment_assets
          where symbol = 'JEONGMIN_ROCKET'
        );
        pct_two := greatest(min_pct, least(max_pct, previous_pct_two + movement_direction * step_two));
        if pct = 0 then pct := movement_direction; end if;
        if pct_two = 0 then pct_two := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol in ('SAMSUNG_MICROWAVE', 'SEOK_HYNIX') then
      daily_direction := (direction_state_value->>'SAMSUNG_MICROWAVE')::integer;
      min_pct := -15;
      max_pct := 15;
      movement_direction := public.investment_next_direction(previous_pct, daily_direction);
      step := floor(random() * 5) + 1;
      step_two := floor(random() * 5) + 1;
      pct := greatest(min_pct, least(max_pct, previous_pct + movement_direction * step));
      previous_pct_two := (
        select change_pct from public.investment_assets
        where symbol = 'SEOK_HYNIX'
      );
      pct_two := greatest(min_pct, least(max_pct, previous_pct_two + movement_direction * step_two));
      if pct = 0 then pct := movement_direction; end if;
      if pct_two = 0 then pct_two := movement_direction; end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'SANGI_BIO' then
      daily_direction := (direction_state_value->>'SANGI_BIO')::integer;
      if new_direction_day and (direction_state_value->>'bio_event')::boolean
         and daily_direction > 0 then
        pct := floor(random() * 501) + 500;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 5) + 1;
        pct := greatest(-30, least(30, previous_pct + movement_direction * step));
        if pct = 0 then pct := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol in (
      'SURGE_STOCK',
      'CURRENT_SURGE_STOCK',
      'DONGHWA_SURGE_STOCK',
      'JEONGMIN_SURGE_STOCK',
      'JUSEONG_SURGE_STOCK'
    ) then
      daily_direction := (direction_state_value->>asset.symbol)::integer;
      if random() < 0.01 then
        pct := floor(random() * 1801) + 200;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 100) + 1;
        pct := greatest(-100, least(100, previous_pct + movement_direction * step));
        if pct = 0 then pct := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'KOREA_SANGI_INDEX' then
      daily_direction := (direction_state_value->>'KOREA_SANGI_INDEX')::integer;
      movement_direction := public.investment_next_direction(previous_pct, daily_direction);
      step := floor(random() * 3) + 1;
      pct := greatest(-1, least(3, previous_pct + movement_direction * step));
      if pct = 0 then pct := movement_direction; end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'SANGI_AI' then
      daily_direction := (direction_state_value->>'SANGI_AI')::integer;
      movement_direction := public.investment_next_direction(previous_pct, daily_direction);
      step := floor(random() * 5) + 1;
      pct := greatest(-10, least(20, previous_pct + movement_direction * step));
      if pct = 0 then pct := movement_direction; end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    else
      daily_direction := (direction_state_value->>'QUANTUM_YOON')::integer;
      if new_direction_day and (direction_state_value->>'quantum_event')::boolean
         and daily_direction > 0 then
        pct := floor(random() * 101) + 100;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 5) + 1;
        pct := greatest(-30, least(50, previous_pct + movement_direction * step));
        if pct = 0 then pct := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    end if;

    if previous_pct >= 10 and random() < 0.7 then
      pct := -abs(pct);
      next_price := round(asset.current_price * (1 + pct / 100));
    end if;

    update public.investment_assets
    set current_price = case when next_price <= 10 then 0 else next_price end,
        change_pct = pct,
        listed = next_price > 10
    where symbol = asset.symbol;

    if next_price <= 10 then
      delete from public.investment_holdings where symbol = asset.symbol;
    end if;

    if asset.symbol = 'SANGI_ROCKET' then
      if (
        select change_pct
        from public.investment_assets
        where symbol = 'JEONGMIN_ROCKET'
      ) >= 10 and random() < 0.7 then
        pct_two := -abs(pct_two);
      end if;

      update public.investment_assets
      set current_price = case when round(current_price * (1 + pct_two / 100)) <= 10 then 0 else round(current_price * (1 + pct_two / 100)) end,
          change_pct = pct_two,
          listed = round(current_price * (1 + pct_two / 100)) > 10
      where symbol = 'JEONGMIN_ROCKET';
    end if;
  end loop;

  -- 시장 가격 계산이 끝난 뒤 분할을 적용해 다음 갱신이 분할 가격을 기준으로 시작되게 한다.
  perform public.investment_apply_stock_splits();

  update public.investment_market
  set last_market_date = today,
      last_price_update = current_bucket
  where id = 1;
  return today;
end;
$$;

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
    'market_date', (select last_market_date from public.investment_market where id = 1),
    'assets', coalesce((
      select jsonb_agg(
        jsonb_set(
          to_jsonb(a),
          '{current_price_exact}',
          to_jsonb(a.current_price::text)
        )
        order by a.symbol
      )
      from public.investment_assets a
    ), '[]'::jsonb),
    'holdings', coalesce((select jsonb_agg(to_jsonb(h) order by h.symbol) from public.investment_holdings h where h.client_id = u.client_id), '[]'::jsonb),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', r.client_id, 'nickname', r.nickname, 'total_asset', r.total_asset) order by r.total_asset desc)
      from (
        select iu.client_id, iu.nickname, iu.cash + coalesce((
          select sum(ih.quantity * ia.current_price)
          from public.investment_holdings ih
          join public.investment_assets ia on ia.symbol = ih.symbol
          where ih.client_id = iu.client_id and ia.listed
        ), 0) as total_asset
        from public.investment_users iu
      ) r
    ), '[]'::jsonb)
  )
  from public.investment_users u
  where u.client_id = p_client_id;
$$;

create or replace function public.investment_get_state(
  p_client_id uuid,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.investment_update_market();
  if trim(p_nickname) is null
     or char_length(trim(p_nickname)) = 0
     or char_length(trim(p_nickname)) > 24 then
    raise exception '닉네임은 1~24자로 입력하세요.';
  end if;

  if exists (
    select 1
    from public.investment_users
    where nickname = trim(p_nickname)
      and client_id <> p_client_id
  ) then
    raise exception '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력하세요.';
  end if;

  insert into public.investment_users (client_id, nickname)
  values (p_client_id, trim(p_nickname))
  on conflict (client_id) do nothing;
  return public.investment_build_state(p_client_id);
end;
$$;

create or replace function public.investment_admin_grant_cash(
  p_admin_password text,
  p_target_client_id uuid,
  p_amount bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_amount is null or p_amount < 1 then
    raise exception '지급액은 1원 이상이어야 합니다.';
  end if;

  update public.investment_users
  set cash = cash + p_amount
  where client_id = p_target_client_id;

  if not found then
    raise exception '지급할 투자자를 찾을 수 없습니다.';
  end if;

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_target_client_id,
    '관리자가 ' || to_char(p_amount, 'FM999,999,999,999,999,999,999')
      || '원을 지급했습니다.'
  );

  return true;
end;
$$;

create or replace function public.investment_transfer_cash(
  p_sender_client_id uuid,
  p_recipient_client_id uuid,
  p_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_user public.investment_users%rowtype;
  recipient_user public.investment_users%rowtype;
begin
  if p_sender_client_id is null
     or p_recipient_client_id is null
     or p_sender_client_id = p_recipient_client_id then
    raise exception '자기 자신에게는 송금할 수 없습니다.';
  end if;

  if p_amount is null or p_amount < 1 then
    raise exception '송금액은 1원 이상이어야 합니다.';
  end if;

  if p_sender_client_id < p_recipient_client_id then
    select * into sender_user
    from public.investment_users
    where client_id = p_sender_client_id
    for update;
    select * into recipient_user
    from public.investment_users
    where client_id = p_recipient_client_id
    for update;
  else
    select * into recipient_user
    from public.investment_users
    where client_id = p_recipient_client_id
    for update;
    select * into sender_user
    from public.investment_users
    where client_id = p_sender_client_id
    for update;
  end if;

  if sender_user.client_id is null then
    raise exception '송금하는 투자자를 찾을 수 없습니다.';
  end if;
  if recipient_user.client_id is null then
    raise exception '받는 투자자를 찾을 수 없습니다.';
  end if;
  if sender_user.cash < p_amount then
    raise exception '보유 현금이 부족합니다.';
  end if;

  update public.investment_users
  set cash = cash - p_amount
  where client_id = p_sender_client_id;

  update public.investment_users
  set cash = cash + p_amount
  where client_id = p_recipient_client_id;

  insert into public.investment_shop_messages(client_id, message)
  values
    (
      p_sender_client_id,
      recipient_user.nickname || '에게 '
        || to_char(p_amount, 'FM999,999,999,999,999,999,999')
        || '원을 송금했습니다.'
    ),
    (
      p_recipient_client_id,
      sender_user.nickname || '님이 '
        || to_char(p_amount, 'FM999,999,999,999,999,999,999')
        || '원을 송금했습니다.'
    );

  return jsonb_build_object(
    'message',
    recipient_user.nickname || '에게 '
      || to_char(p_amount, 'FM999,999,999,999,999,999,999')
      || '원을 송금했습니다.'
  );
end;
$$;

create or replace function public.investment_admin_adjust_cash(
  p_admin_password text,
  p_target_client_id uuid,
  p_amount bigint
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_cash bigint;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception '조정 금액은 0원이 될 수 없습니다.';
  end if;

  select cash into current_cash
  from public.investment_users
  where client_id = p_target_client_id
  for update;

  if current_cash is null then
    raise exception '조정할 투자자를 찾을 수 없습니다.';
  end if;

  if p_amount < 0 and current_cash + p_amount < 0 then
    raise exception '현금은 0원 아래로 차감할 수 없습니다.';
  end if;

  update public.investment_users
  set cash = cash + p_amount
  where client_id = p_target_client_id;

  return true;
end;
$$;

drop function if exists public.investment_trade(uuid, text, text, integer);

create or replace function public.investment_trade(
  p_client_id uuid,
  p_symbol text,
  p_side text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row public.investment_users%rowtype;
  asset_row public.investment_assets%rowtype;
  current_quantity bigint;
  current_invested bigint;
  total_price bigint;
begin
  perform public.investment_update_market();
  select * into user_row from public.investment_users where client_id = p_client_id for update;
  if user_row.client_id is null then raise exception '먼저 닉네임을 설정하세요.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception '수량은 1주 이상이어야 합니다.'; end if;
  select * into asset_row from public.investment_assets where symbol = p_symbol for update;
  if asset_row.symbol is null or not asset_row.listed then raise exception '현재 거래할 수 없는 상품입니다.'; end if;
  total_price := asset_row.current_price * p_quantity;
  select coalesce(quantity, 0), coalesce(invested_amount, 0)
  into current_quantity, current_invested
  from public.investment_holdings
  where client_id = p_client_id and symbol = p_symbol;

  if p_side = 'buy' then
    if user_row.cash < total_price then raise exception '보유 현금이 부족합니다.'; end if;
    update public.investment_users set cash = cash - total_price where client_id = p_client_id;
    insert into public.investment_holdings (client_id, symbol, quantity, invested_amount)
    values (p_client_id, p_symbol, p_quantity, total_price)
    on conflict (client_id, symbol) do update
    set quantity = public.investment_holdings.quantity + excluded.quantity,
        invested_amount = public.investment_holdings.invested_amount + excluded.invested_amount;
  elsif p_side = 'sell' then
    if current_quantity < p_quantity then raise exception '보유 주식보다 많이 팔 수 없습니다.'; end if;
    update public.investment_users set cash = cash + total_price where client_id = p_client_id;
    update public.investment_holdings
    set quantity = quantity - p_quantity,
        invested_amount = case
          when p_quantity = current_quantity then 0
          else invested_amount - round(invested_amount * p_quantity::numeric / current_quantity)
        end
    where client_id = p_client_id and symbol = p_symbol;
  else
    raise exception '잘못된 거래 유형입니다.';
  end if;
  return public.investment_build_state(p_client_id);
end;
$$;

revoke all on function public.investment_get_state(uuid, text) from public;
revoke all on function public.investment_trade(uuid, text, text, bigint) from public;
revoke all on function public.investment_admin_grant_cash(text, uuid, bigint) from public;
revoke all on function public.investment_admin_adjust_cash(text, uuid, bigint) from public;
grant execute on function public.investment_get_state(uuid, text) to anon;
grant execute on function public.investment_trade(uuid, text, text, bigint) to anon;
grant execute on function public.investment_admin_grant_cash(text, uuid, bigint) to anon;
grant execute on function public.investment_admin_adjust_cash(text, uuid, bigint) to anon;
grant execute on function public.investment_transfer_cash(uuid, uuid, bigint) to anon, authenticated;

alter table public.investment_assets
  add column if not exists surge_spike boolean not null default false;
alter table public.investment_assets
  add column if not exists split_notice boolean not null default false;
alter table public.investment_assets
  add column if not exists was_delisted boolean not null default false;
alter table public.investment_assets
  add column if not exists delisted_at timestamptz;

create table if not exists public.investment_surge_settings (
  id integer primary key check (id = 1),
  normal_max numeric not null default 30,
  spike_chance numeric not null default 1,
  spike_min numeric not null default 200,
  spike_max numeric not null default 2000,
  crash_chance numeric not null default 60,
  crash_min numeric not null default 50,
  crash_max numeric not null default 90
);

insert into public.investment_surge_settings (id)
values (1)
on conflict (id) do nothing;

update public.investment_surge_settings
set spike_chance = 1,
    spike_min = 200,
    spike_max = 2000
where id = 1;

create or replace function public.investment_admin_reset_asset(
  p_admin_password text,
  p_symbol text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  perform 1 from public.investment_assets where symbol = p_symbol for update;
  if not found then
    raise exception '초기화할 종목을 찾을 수 없습니다.';
  end if;

  perform set_config('app.investment_admin_reset', 'on', true);
  update public.investment_assets
  set current_price = base_price,
      change_pct = 0,
      listed = true,
      surge_spike = false,
      split_notice = false,
      was_delisted = false,
      delisted_at = null
  where symbol = p_symbol;
  perform set_config('app.investment_admin_reset', 'off', true);
  return true;
end;
$$;

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
  v_current_price bigint;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  select current_price
  into v_current_price
  from public.investment_assets
  where symbol = p_symbol
  for update;

  if not found then
    raise exception '액면분할할 종목을 찾을 수 없습니다.';
  end if;

  perform set_config('app.investment_admin_reset', 'on', true);

  update public.investment_holdings
  set quantity = quantity * 1000
  where symbol = p_symbol;

  update public.investment_assets
  set current_price = greatest(1, round(current_price::numeric / 1000)::bigint),
      change_pct = 0,
      split_notice = true
  where symbol = p_symbol;

  perform set_config('app.investment_admin_reset', 'off', true);
  return true;
end;
$$;

create or replace function public.investment_admin_reset_all_assets(
  p_admin_password text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  perform set_config('app.investment_admin_reset', 'on', true);
  update public.investment_assets
  set current_price = base_price,
      change_pct = 0,
      listed = true,
      surge_spike = false,
      split_notice = false,
      was_delisted = false,
      delisted_at = null;
  update public.investment_market
  set last_price_update =
        date_trunc('hour', now())
        + make_interval(mins => (floor(extract(minute from now()) / 5) * 5)::integer)
  where id = 1;
  perform set_config('app.investment_admin_reset', 'off', true);
  return true;
end;
$$;

create or replace function public.investment_admin_set_surge_volatility(
  p_admin_password text,
  p_normal_max numeric,
  p_spike_chance numeric,
  p_spike_min numeric,
  p_spike_max numeric,
  p_crash_chance numeric,
  p_crash_min numeric,
  p_crash_max numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;
  if p_normal_max < 1 or p_normal_max > 100
     or p_spike_chance < 0 or p_spike_chance > 100
     or p_spike_min < 1 or p_spike_min > p_spike_max
     or p_crash_chance < 0 or p_crash_chance > 100
     or p_crash_min < 1 or p_crash_min > p_crash_max
     or p_crash_max > 100 then
    raise exception '변동성 값의 범위가 올바르지 않습니다.';
  end if;

  insert into public.investment_surge_settings (
    id, normal_max, spike_chance, spike_min, spike_max,
    crash_chance, crash_min, crash_max
  )
  values (
    1, p_normal_max, p_spike_chance, p_spike_min, p_spike_max,
    p_crash_chance, p_crash_min, p_crash_max
  )
  on conflict (id) do update set
    normal_max = excluded.normal_max,
    spike_chance = excluded.spike_chance,
    spike_min = excluded.spike_min,
    spike_max = excluded.spike_max,
    crash_chance = excluded.crash_chance,
    crash_min = excluded.crash_min,
    crash_max = excluded.crash_max;
  return true;
end;
$$;

create or replace function public.apply_surge_stock_volatility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.investment_surge_settings%rowtype;
  movement_direction integer;
  movement_pct numeric;
  next_price bigint;
begin
  if current_setting('app.investment_admin_reset', true) = 'on'
     or new.symbol not in (
       'SURGE_STOCK', 'CURRENT_SURGE_STOCK', 'DONGHWA_SURGE_STOCK',
       'JEONGMIN_SURGE_STOCK', 'JUSEONG_SURGE_STOCK'
     ) then
    return new;
  end if;

  select * into settings
  from public.investment_surge_settings
  where id = 1;

  if old.surge_spike then
    if random() < settings.crash_chance / 100 then
      movement_pct := -(floor(random() * (settings.crash_max - settings.crash_min + 1)) + settings.crash_min);
    else
      movement_direction := case
        when old.change_pct <= -10 and random() < 0.7 then 1
        when old.change_pct <> 0 and random() < 0.7 then sign(old.change_pct)::integer
        when old.change_pct <> 0 then -sign(old.change_pct)::integer
        else case when random() < 0.5 then -1 else 1 end
      end;
      movement_pct := movement_direction * (floor(random() * settings.normal_max) + 1);
    end if;
    next_price := round(old.current_price * (1 + movement_pct / 100));
    new.current_price := greatest(next_price, 0);
    new.change_pct := movement_pct;
    new.listed := next_price > 10;
    new.surge_spike := false;
    return new;
  end if;

  if random() < settings.spike_chance / 100 then
    movement_pct := floor(random() * (settings.spike_max - settings.spike_min + 1)) + settings.spike_min;
    next_price := round(old.current_price * (1 + movement_pct / 100));
    new.current_price := next_price;
    new.change_pct := movement_pct;
    new.listed := true;
    new.surge_spike := true;
    return new;
  end if;

  movement_direction := case
    when old.change_pct <= -10 and random() < 0.7 then 1
    when old.change_pct <> 0 and random() < 0.7 then sign(old.change_pct)::integer
    when old.change_pct <> 0 then -sign(old.change_pct)::integer
    else case when random() < 0.5 then -1 else 1 end
  end;
  movement_pct := movement_direction * (floor(random() * settings.normal_max) + 1);
  next_price := round(old.current_price * (1 + movement_pct / 100));
  new.current_price := greatest(next_price, 0);
  new.change_pct := movement_pct;
  new.listed := next_price > 10;
  new.surge_spike := false;
  return new;
end;
$$;

drop trigger if exists investment_surge_volatility_trigger
on public.investment_assets;

create trigger investment_surge_volatility_trigger
before update of current_price, change_pct, listed
on public.investment_assets
for each row
execute function public.apply_surge_stock_volatility();

revoke all on function public.investment_admin_reset_asset(text, text) from public;
revoke all on function public.investment_admin_split_asset(text, text) from public;
revoke all on function public.investment_admin_reset_all_assets(text) from public;
revoke all on function public.investment_admin_set_surge_volatility(text, numeric, numeric, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function public.investment_admin_reset_asset(text, text) to anon, authenticated;
grant execute on function public.investment_admin_split_asset(text, text) to anon, authenticated;
grant execute on function public.investment_admin_reset_all_assets(text) to anon, authenticated;
grant execute on function public.investment_admin_set_surge_volatility(text, numeric, numeric, numeric, numeric, numeric, numeric, numeric) to anon, authenticated;

-- Stock split and relisting metadata.
alter table public.investment_assets
  add column if not exists split_notice boolean not null default false;
alter table public.investment_assets
  add column if not exists was_delisted boolean not null default false;
alter table public.investment_assets
  add column if not exists delisted_at timestamptz;

alter table public.investment_holdings
  alter column quantity type bigint using quantity::bigint;

create or replace function public.investment_apply_stock_splits()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_row record;
  v_split_factor bigint;
begin
  for asset_row in
    select symbol, current_price
    from public.investment_assets
    where listed = true
      and (
        (
          symbol in (
            'SURGE_STOCK',
            'CURRENT_SURGE_STOCK',
            'DONGHWA_SURGE_STOCK',
            'JEONGMIN_SURGE_STOCK',
            'JUSEONG_SURGE_STOCK'
          )
          and current_price >= 1000000
        )
        or (
          symbol in ('SANGI_ROCKET', 'JEONGMIN_ROCKET', 'SANGI_BIO')
          and current_price > 1000000
        )
        or (
          symbol in ('SEOK_HYNIX', 'SAMSUNG_MICROWAVE')
          and current_price > 10000000
        )
        or (
          symbol not in (
            'SURGE_STOCK',
            'CURRENT_SURGE_STOCK',
            'DONGHWA_SURGE_STOCK',
            'JEONGMIN_SURGE_STOCK',
            'JUSEONG_SURGE_STOCK',
            'SANGI_ROCKET',
            'JEONGMIN_ROCKET',
            'SANGI_BIO',
            'SEOK_HYNIX',
            'SAMSUNG_MICROWAVE'
          )
          and current_price > 1000000
        )
      )
    for update
  loop
    if asset_row.symbol in (
      'SURGE_STOCK',
      'CURRENT_SURGE_STOCK',
      'DONGHWA_SURGE_STOCK',
      'JEONGMIN_SURGE_STOCK',
      'JUSEONG_SURGE_STOCK'
    ) then
      v_split_factor := 1000;
    elsif asset_row.symbol in ('SEOK_HYNIX', 'SAMSUNG_MICROWAVE') then
      v_split_factor := 10;
    else
      v_split_factor := 100;
    end if;

    update public.investment_holdings
    set quantity = quantity * v_split_factor
    where symbol = asset_row.symbol;

    update public.investment_assets
    set current_price = greatest(
          1,
          round(current_price::numeric / v_split_factor)::bigint
        ),
        split_notice = true
    where symbol = asset_row.symbol;

  end loop;
end;
$$;

create or replace function public.track_investment_listing_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listed = false and old.listed = true then
    new.delisted_at := coalesce(new.delisted_at, now());
    new.was_delisted := true;
  elsif new.listed = true and old.listed = false then
    new.delisted_at := null;
    new.was_delisted := true;
  end if;
  return new;
end;
$$;

drop trigger if exists investment_listing_status_trigger
on public.investment_assets;

create trigger investment_listing_status_trigger
before update of listed on public.investment_assets
for each row
execute function public.track_investment_listing_status();

drop trigger if exists investment_stock_split_trigger
on public.investment_assets;

drop function if exists public.investment_stock_split_trigger();

create or replace function public.investment_relist_delisted_assets()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.investment_assets
  set current_price = base_price,
      change_pct = 0,
      listed = true,
      delisted_at = null,
      was_delisted = true
  where listed = false
    and delisted_at is not null
    and delisted_at <= now() - interval '5 minutes';

  perform public.investment_apply_stock_splits();
end;
$$;

create or replace function public.investment_market_cron_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.investment_relist_delisted_assets();
  perform public.investment_update_market();
  perform public.investment_apply_stock_splits();
end;
$$;

revoke all on function public.investment_apply_stock_splits() from public;
revoke all on function public.investment_relist_delisted_assets() from public;
revoke all on function public.investment_market_cron_tick() from public;
grant execute on function public.investment_apply_stock_splits() to anon, authenticated;

create or replace function public.investment_link_account(
  p_old_client_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  account_id uuid := auth.uid();
  old_user public.investment_users%rowtype;
  target_user public.investment_users%rowtype;
begin
  if account_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if p_old_client_id is null or p_old_client_id = account_id then
    return true;
  end if;

  select * into old_user
  from public.investment_users
  where client_id = p_old_client_id
  for update;

  if old_user.client_id is null then
    return true;
  end if;

  select * into target_user
  from public.investment_users
  where client_id = account_id
  for update;

  if target_user.client_id is null then
    insert into public.investment_users (client_id, nickname, cash)
    values (account_id, old_user.nickname, old_user.cash);
  else
    update public.investment_users
    set cash = target_user.cash + old_user.cash
    where client_id = account_id;
  end if;

  insert into public.investment_holdings (client_id, symbol, quantity, invested_amount)
  select account_id, symbol, quantity, invested_amount
  from public.investment_holdings
  where client_id = p_old_client_id
  on conflict (client_id, symbol) do update
  set quantity = public.investment_holdings.quantity + excluded.quantity,
      invested_amount = public.investment_holdings.invested_amount + excluded.invested_amount;

  delete from public.investment_holdings
  where client_id = p_old_client_id;
  delete from public.investment_users
  where client_id = p_old_client_id;

  return true;
end;
$$;

revoke all on function public.investment_link_account(uuid) from public;
grant execute on function public.investment_link_account(uuid) to authenticated;
grant execute on function public.investment_relist_delisted_assets() to anon, authenticated;
grant execute on function public.investment_market_cron_tick() to anon, authenticated;

create extension if not exists pgcrypto;

create table if not exists public.site_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.site_account_sessions (
  token uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.site_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);

alter table public.site_accounts enable row level security;
alter table public.site_account_sessions enable row level security;
revoke all on table public.site_accounts, public.site_account_sessions from anon, authenticated;

create or replace function public.site_account_signup(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.site_accounts%rowtype;
  session_token uuid;
begin
  if p_username is null or p_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception '아이디는 영문 소문자, 숫자, 밑줄(_)만 사용해 3~24자로 입력하세요.';
  end if;
  if p_password is null or char_length(p_password) < 8 then
    raise exception '비밀번호는 8자 이상이어야 합니다.';
  end if;
  if exists (select 1 from public.site_accounts where username = p_username) then
    raise exception '이미 사용 중인 아이디입니다.';
  end if;

  insert into public.site_accounts (username, password_hash)
  values (p_username, crypt(p_password, gen_salt('bf')))
  returning * into account_row;

  insert into public.site_account_sessions (account_id)
  values (account_row.id)
  returning token into session_token;

  return jsonb_build_object(
    'account_id', account_row.id,
    'username', account_row.username,
    'session_token', session_token
  );
end;
$$;

create or replace function public.site_account_login(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.site_accounts%rowtype;
  session_token uuid;
begin
  select * into account_row
  from public.site_accounts
  where username = lower(trim(p_username));

  if account_row.id is null
     or account_row.password_hash <> crypt(p_password, account_row.password_hash) then
    raise exception '아이디 또는 비밀번호가 올바르지 않습니다.';
  end if;

  insert into public.site_account_sessions (account_id)
  values (account_row.id)
  returning token into session_token;

  return jsonb_build_object(
    'account_id', account_row.id,
    'username', account_row.username,
    'session_token', session_token
  );
end;
$$;

drop function if exists public.investment_link_account(uuid);
drop function if exists public.investment_link_account(uuid, uuid);

create or replace function public.investment_link_account(
  p_session_token uuid,
  p_old_client_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_username text;
  v_target_nickname text;
  v_suffix integer := 0;
  old_user public.investment_users%rowtype;
  target_user public.investment_users%rowtype;
begin
  select s.account_id, a.username
  into v_account_id, v_account_username
  from public.site_account_sessions s
  join public.site_accounts a on a.id = s.account_id
  where s.token = p_session_token and s.expires_at > now();
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;
  if p_old_client_id is null or p_old_client_id = v_account_id then
    return true;
  end if;

  select * into old_user from public.investment_users
  where client_id = p_old_client_id for update;
  if old_user.client_id is null then return true; end if;

  select * into target_user from public.investment_users
  where client_id = v_account_id for update;
  if target_user.client_id is null then
    v_target_nickname := old_user.nickname;
    if exists (
      select 1
      from public.investment_users
      where nickname = v_target_nickname
        and client_id <> p_old_client_id
    ) then
      v_target_nickname := left(v_account_username, 18) || '_' ||
        substr(replace(v_account_id::text, '-', ''), 1, 5);
    end if;
    while exists (
      select 1
      from public.investment_users
      where nickname = v_target_nickname
    ) loop
      v_suffix := v_suffix + 1;
      v_target_nickname := left(v_account_username, 18) || '_' ||
        substr(replace(v_account_id::text, '-', ''), 1, 4) ||
        right('0' || v_suffix::text, 2);
    end loop;
    insert into public.investment_users (client_id, nickname, cash)
    values (v_account_id, v_target_nickname, old_user.cash);
  else
    update public.investment_users
    set cash = target_user.cash + old_user.cash
    where client_id = v_account_id;
  end if;

  insert into public.investment_holdings (client_id, symbol, quantity, invested_amount)
  select v_account_id, symbol, quantity, invested_amount
  from public.investment_holdings
  where client_id = p_old_client_id
  on conflict (client_id, symbol) do update
  set quantity = public.investment_holdings.quantity + excluded.quantity,
      invested_amount = public.investment_holdings.invested_amount + excluded.invested_amount;

  delete from public.investment_holdings where client_id = p_old_client_id;
  delete from public.investment_users where client_id = p_old_client_id;
  return true;
end;
$$;

revoke all on function public.site_account_signup(text, text) from public;
revoke all on function public.site_account_login(text, text) from public;
revoke all on function public.investment_link_account(uuid, uuid) from public;
grant execute on function public.site_account_signup(text, text) to anon, authenticated;
grant execute on function public.site_account_login(text, text) to anon, authenticated;
grant execute on function public.investment_link_account(uuid, uuid) to anon, authenticated;

alter function public.site_account_signup(text, text)
  set search_path = public, extensions;
alter function public.site_account_login(text, text)
  set search_path = public, extensions;
alter function public.investment_link_account(uuid, uuid)
  set search_path = public, extensions;

alter table public.site_accounts
  add column if not exists signup_bonus_granted boolean
  not null default false;

create or replace function public.investment_get_state(
  p_client_id uuid,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  account_bonus_pending boolean := false;
begin
  perform public.investment_update_market();

  if trim(p_nickname) is null
     or char_length(trim(p_nickname)) = 0
     or char_length(trim(p_nickname)) > 24 then
    raise exception '닉네임은 1~24자로 입력하세요.';
  end if;

  if exists (
    select 1
    from public.investment_users
    where nickname = trim(p_nickname)
      and client_id <> p_client_id
  ) then
    raise exception '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력하세요.';
  end if;

  select not coalesce(signup_bonus_granted, false)
  into account_bonus_pending
  from public.site_accounts
  where id = p_client_id
  for update;

  insert into public.investment_users (client_id, nickname)
  values (p_client_id, trim(p_nickname))
  on conflict (client_id) do nothing;

  if account_bonus_pending then
    update public.investment_users
    set cash = cash + 500000
    where client_id = p_client_id;

    update public.site_accounts
    set signup_bonus_granted = true
    where id = p_client_id;
  end if;

  return public.investment_build_state(p_client_id);
end;
$$;

create or replace function public.investment_link_account(
  p_session_token uuid,
  p_old_client_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  old_user public.investment_users%rowtype;
  target_user public.investment_users%rowtype;
begin
  select s.account_id
  into v_account_id
  from public.site_account_sessions s
  join public.site_accounts a on a.id = s.account_id
  where s.token = p_session_token
    and s.expires_at > now()
  for update of a;

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  if p_old_client_id is null
     or p_old_client_id = v_account_id then
    return true;
  end if;

  select *
  into old_user
  from public.investment_users
  where client_id = p_old_client_id
  for update;

  if old_user.client_id is null then
    return true;
  end if;

  select *
  into target_user
  from public.investment_users
  where client_id = v_account_id
  for update;

  if target_user.client_id is null then
    if exists (
      select 1
      from public.investment_users
      where nickname = old_user.nickname
        and client_id <> p_old_client_id
    ) then
      raise exception '기존 닉네임이 이미 사용 중이어서 투자 정보를 연동할 수 없습니다.';
    end if;

    insert into public.investment_users (client_id, nickname, cash)
    values (v_account_id, old_user.nickname, old_user.cash);
  else
    if target_user.nickname <> old_user.nickname
       and exists (
         select 1
         from public.investment_users
         where nickname = old_user.nickname
           and client_id <> p_old_client_id
       ) then
      raise exception '기존 닉네임이 이미 사용 중이어서 투자 정보를 연동할 수 없습니다.';
    end if;

    update public.investment_users
    set nickname = old_user.nickname,
        cash = target_user.cash + old_user.cash
    where client_id = v_account_id;
  end if;

  insert into public.investment_holdings (
    client_id, symbol, quantity, invested_amount
  )
  select v_account_id, symbol, quantity, invested_amount
  from public.investment_holdings
  where client_id = p_old_client_id
  on conflict (client_id, symbol)
  do update set
    quantity = public.investment_holdings.quantity + excluded.quantity,
    invested_amount =
      public.investment_holdings.invested_amount + excluded.invested_amount;

  delete from public.investment_holdings
  where client_id = p_old_client_id;

  delete from public.investment_users
  where client_id = p_old_client_id;

  return true;
end;
$$;

revoke all on function public.investment_get_state(uuid, text) from public;
grant execute on function public.investment_get_state(uuid, text)
to anon, authenticated;

revoke all on function public.investment_build_state(uuid)
from public;
grant execute on function public.investment_build_state(uuid)
to anon, authenticated;

revoke all on function public.investment_link_account(uuid, uuid)
from public;

grant execute on function public.investment_link_account(uuid, uuid)
to anon, authenticated;

create or replace function public.investment_admin_rename_user(
  p_admin_password text,
  p_target_client_id uuid,
  p_nickname text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_nickname is null
     or char_length(trim(p_nickname)) < 1
     or char_length(trim(p_nickname)) > 24 then
    raise exception '닉네임은 1~24자로 입력하세요.';
  end if;

  if exists (
    select 1
    from public.investment_users
    where nickname = trim(p_nickname)
      and client_id <> p_target_client_id
  ) then
    raise exception '이미 사용 중인 닉네임입니다.';
  end if;

  update public.investment_users
  set nickname = trim(p_nickname)
  where client_id = p_target_client_id;

  if not found then
    raise exception '변경할 투자자를 찾을 수 없습니다.';
  end if;

  return true;
end;
$$;

revoke all on function public.investment_admin_rename_user(text, uuid, text)
from public;

grant execute on function public.investment_admin_rename_user(text, uuid, text)
to anon, authenticated;

create table if not exists public.site_account_presence (
  account_id uuid primary key references public.site_accounts(id) on delete cascade,
  username text not null,
  last_seen_at timestamptz not null default now()
);

alter table public.site_account_presence enable row level security;
revoke all on table public.site_account_presence from anon, authenticated;

create or replace function public.site_account_presence_heartbeat(
  p_session_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_nickname text;
begin
  select s.account_id
  into v_account_id
  from public.site_account_sessions s
  where s.token = p_session_token
    and s.expires_at > now();

  if v_account_id is null then
    return false;
  end if;

  select nickname
  into v_nickname
  from public.investment_users
  where client_id = v_account_id;

  if v_nickname is null then
    delete from public.site_account_presence
    where account_id = v_account_id;
    return false;
  end if;

  insert into public.site_account_presence(account_id, username, last_seen_at)
  values (v_account_id, v_nickname, now())
  on conflict (account_id) do update
  set username = excluded.username,
      last_seen_at = now();

  return true;
end;
$$;

create or replace function public.site_account_online_users()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nickname', iu.nickname,
        'username', iu.nickname,
        'is_online', exists (
          select 1
          from public.site_account_presence p
          where p.account_id = iu.client_id
            and p.last_seen_at > now() - interval '2 minutes'
        )
      )
      order by iu.nickname
    ),
    '[]'::jsonb
  )
  from public.investment_users iu
  join public.site_accounts a
    on a.id = iu.client_id;
$$;

revoke all on function public.site_account_presence_heartbeat(uuid)
from public;
revoke all on function public.site_account_online_users()
from public;

grant execute on function public.site_account_presence_heartbeat(uuid)
to anon, authenticated;
grant execute on function public.site_account_online_users()
to anon, authenticated;

create table if not exists public.investment_shop_items (
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  item_type text not null check (item_type in ('low_missile', 'mid_missile', 'high_missile', 'nickname_ticket', 'letter')),
  quantity bigint not null default 0 check (quantity >= 0),
  primary key (client_id, item_type)
);

alter table public.investment_shop_items enable row level security;
revoke all on table public.investment_shop_items from anon, authenticated;
alter table public.investment_shop_items
  drop constraint if exists investment_shop_items_item_type_check;
alter table public.investment_shop_items
  add constraint investment_shop_items_item_type_check
  check (item_type in (
    'low_missile',
    'mid_missile',
    'high_missile',
    'nickname_ticket',
    'letter'
  ));

create table if not exists public.investment_shop_messages (
  id bigint generated by default as identity primary key,
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.investment_shop_messages enable row level security;
revoke all on table public.investment_shop_messages from anon, authenticated;

create or replace function public.shop_get_unread_count(p_client_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'count',
    count(*)::integer
  )
  from public.investment_shop_messages
  where client_id = p_client_id
    and read_at is null;
$$;

create or replace function public.shop_get_messages(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'message', message,
        'created_at', created_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into v_messages
  from public.investment_shop_messages
  where client_id = p_client_id;

  update public.investment_shop_messages
  set read_at = now()
  where client_id = p_client_id
    and read_at is null;

  return jsonb_build_object('messages', v_messages);
end;
$$;

create or replace function public.shop_get_state(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash bigint;
begin
  select cash into v_cash
  from public.investment_users
  where client_id = p_client_id;

  if v_cash is null then
    raise exception '먼저 투자 닉네임을 설정하세요.';
  end if;

  return jsonb_build_object(
    'cash', v_cash,
    'cash_exact', v_cash::text,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_type', item_type,
        'name', case item_type
          when 'low_missile' then '하급 미사일'
          when 'mid_missile' then '중급 미사일'
          when 'high_missile' then '고급 미사일'
          when 'nickname_ticket' then '닉네임 변경권'
          else '편지'
        end,
        'quantity', quantity
      ) order by item_type)
      from public.investment_shop_items
      where client_id = p_client_id
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', u.client_id,
        'nickname', u.nickname,
        'total_asset', u.cash + coalesce((
          select sum(h.quantity * a.current_price)
          from public.investment_holdings h
          join public.investment_assets a on a.symbol = h.symbol
          where h.client_id = u.client_id and a.listed
        ), 0)
      ) order by u.nickname)
      from public.investment_users u
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.shop_get_state(
  p_client_id uuid,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := p_client_id;
  v_cash bigint;
begin
  select client_id, cash
  into v_client_id, v_cash
  from public.investment_users
  where client_id = p_client_id;

  if v_cash is null and nullif(trim(p_nickname), '') is not null then
    select client_id, cash
    into v_client_id, v_cash
    from public.investment_users
    where nickname = trim(p_nickname);
  end if;

  if v_cash is null then
    raise exception '저장된 투자 정보를 찾을 수 없습니다. 홈 화면에서 투자 닉네임을 먼저 확인하세요.';
  end if;

  return jsonb_build_object(
    'client_id', v_client_id,
    'cash', v_cash,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_type', item_type,
        'name', case item_type
          when 'low_missile' then '하급 미사일'
          when 'mid_missile' then '중급 미사일'
          when 'high_missile' then '고급 미사일'
          when 'nickname_ticket' then '닉네임 변경권'
          else '편지'
        end,
        'quantity', quantity
      ) order by item_type)
      from public.investment_shop_items
      where client_id = v_client_id
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', u.client_id,
        'nickname', u.nickname,
        'total_asset', u.cash + coalesce((
          select sum(h.quantity * a.current_price)
          from public.investment_holdings h
          join public.investment_assets a on a.symbol = h.symbol
          where h.client_id = u.client_id and a.listed
        ), 0)
      ) order by u.nickname)
      from public.investment_users u
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.shop_purchase(uuid, text);

create or replace function public.shop_purchase(
  p_client_id uuid,
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
  v_cash bigint;
begin
  select price, name into v_price, v_name
  from (values
    ('low_missile', 20000000::bigint, '하급 미사일'),
    ('mid_missile', 50000000::bigint, '중급 미사일'),
    ('high_missile', 150000000::bigint, '고급 미사일'),
    ('nickname_ticket', 5000000000::bigint, '닉네임 변경권'),
    ('letter', 10000::bigint, '편지')
  ) items(item_type, price, name)
  where item_type = p_item_type;

  if v_price is null then
    raise exception '존재하지 않는 상품입니다.';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception '구매 수량은 1개 이상이어야 합니다.';
  end if;

  select cash into v_cash
  from public.investment_users
  where client_id = p_client_id
  for update;

  if v_cash is null then
    raise exception '먼저 투자 닉네임을 설정하세요.';
  end if;
  if v_cash < v_price * p_quantity then
    raise exception '보유 현금이 부족합니다.';
  end if;

  update public.investment_users
  set cash = cash - v_price * p_quantity
  where client_id = p_client_id;

  insert into public.investment_shop_items(client_id, item_type, quantity)
  values (p_client_id, p_item_type, p_quantity)
  on conflict (client_id, item_type)
  do update set quantity = public.investment_shop_items.quantity + excluded.quantity;

  return jsonb_build_object('message', v_name || ' ' || p_quantity || '개를 구매했습니다.');
end;
$$;

-- 기존 1개 구매 호출과의 호환성을 유지합니다.
create or replace function public.shop_purchase(
  p_client_id uuid,
  p_item_type text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.shop_purchase(p_client_id, p_item_type, 1::bigint);
$$;

drop function if exists public.shop_change_nickname(uuid, text);

create or replace function public.shop_change_nickname(
  p_client_id uuid,
  p_target_client_id uuid,
  p_new_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_nickname text;
  v_new_nickname text := trim(p_new_nickname);
  v_quantity bigint;
begin
  if char_length(v_new_nickname) < 1
     or char_length(v_new_nickname) > 24 then
    raise exception '닉네임은 1~24자로 입력하세요.';
  end if;

  if exists (
    select 1
    from public.investment_users
    where nickname = v_new_nickname
      and client_id <> p_target_client_id
  ) then
    raise exception '이미 사용 중인 닉네임입니다.';
  end if;

  select quantity
  into v_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'nickname_ticket'
  for update;

  if coalesce(v_quantity, 0) < 1 then
    raise exception '가방에 닉네임 변경권이 없습니다.';
  end if;

  select nickname
  into v_old_nickname
  from public.investment_users
  where client_id = p_target_client_id
  for update;

  if v_old_nickname is null then
    raise exception '투자정보를 찾을 수 없습니다.';
  end if;

  update public.investment_users
  set nickname = v_new_nickname
  where client_id = p_target_client_id;

  update public.investment_shop_items
  set quantity = quantity - 1
  where client_id = p_client_id
    and item_type = 'nickname_ticket';

  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'nickname_ticket'
    and quantity <= 0;

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_target_client_id,
    '닉네임이 "' || v_old_nickname || '"에서 "' || v_new_nickname
      || '"(으)로 변경되었습니다.'
  );
  if p_target_client_id <> p_client_id then
    insert into public.investment_shop_messages(client_id, message)
    values (
      p_client_id,
      v_old_nickname || '의 닉네임을 "' || v_new_nickname
        || '"(으)로 변경했습니다.'
    );
  end if;

  return jsonb_build_object(
    'message',
    v_old_nickname || '의 닉네임이 "' || v_new_nickname
      || '"(으)로 변경되었습니다.'
  );
end;
$$;

create or replace function public.shop_send_letter(
  p_client_id uuid,
  p_target_client_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
  v_target_name text;
  v_quantity bigint;
  v_message text := trim(p_message);
begin
  if p_target_client_id is null then
    raise exception '편지를 받을 유저를 선택하세요.';
  end if;

  if char_length(v_message) < 1
     or char_length(v_message) > 500 then
    raise exception '편지 내용은 1~500자로 입력하세요.';
  end if;

  select nickname into v_sender_name
  from public.investment_users
  where client_id = p_client_id
  for update;

  if v_sender_name is null then
    raise exception '편지를 보내는 투자자를 찾을 수 없습니다.';
  end if;

  select nickname into v_target_name
  from public.investment_users
  where client_id = p_target_client_id
  for update;

  if v_target_name is null then
    raise exception '편지를 받을 유저를 찾을 수 없습니다.';
  end if;

  select quantity into v_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'letter'
  for update;

  if coalesce(v_quantity, 0) < 1 then
    raise exception '가방에 편지가 없습니다.';
  end if;

  update public.investment_shop_items
  set quantity = quantity - 1
  where client_id = p_client_id
    and item_type = 'letter';

  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'letter'
    and quantity <= 0;

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_target_client_id,
    v_sender_name || '님이 보낸 편지: ' || v_message
  );

  if p_target_client_id = p_client_id then
    return jsonb_build_object(
      'message',
      '나에게 편지를 보냈습니다.'
    );
  end if;

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_client_id,
    v_target_name || '에게 편지를 보냈습니다.'
  );

  return jsonb_build_object(
    'message',
    v_target_name || '에게 편지를 보냈습니다.'
  );
end;
$$;

create or replace function public.shop_use_missile(
  p_client_id uuid,
  p_item_type text,
  p_target_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity bigint;
  v_chance numeric;
  v_damage numeric;
  v_name text;
  v_target_name text;
  v_total bigint;
  v_remaining bigint;
  v_old_cash bigint;
  v_cash_loss bigint;
  holding_row record;
  v_remove_quantity bigint;
  v_removed_value bigint;
  v_actual_loss bigint := 0;
  v_success boolean;
begin
  if p_client_id = p_target_client_id then
    raise exception '자기 자신에게는 사용할 수 없습니다.';
  end if;

  select quantity into v_quantity
  from public.investment_shop_items
  where client_id = p_client_id and item_type = p_item_type
  for update;

  if coalesce(v_quantity, 0) < 1 then
    raise exception '가방에 해당 아이템이 없습니다.';
  end if;

  select nickname into v_target_name
  from public.investment_users
  where client_id = p_target_client_id
  for update;
  if v_target_name is null then
    raise exception '공격 대상을 찾을 수 없습니다.';
  end if;

  select
    case p_item_type
      when 'low_missile' then 0.20
      when 'mid_missile' then 0.30
      when 'high_missile' then 0.40
    end,
    case p_item_type
      when 'low_missile' then 0.20
      when 'mid_missile' then 0.30
      when 'high_missile' then 0.40
    end,
    case p_item_type
      when 'low_missile' then '하급 미사일'
      when 'mid_missile' then '중급 미사일'
      else '고급 미사일'
    end
  into v_chance, v_damage, v_name;

  update public.investment_shop_items
  set quantity = quantity - 1
  where client_id = p_client_id and item_type = p_item_type;

  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
    and quantity <= 0;

  v_success := random() < v_chance;
  if not v_success then
    insert into public.investment_shop_messages(client_id, message)
    values (
      p_client_id,
      v_name || ' 발사 실패. ' || v_target_name
        || '에게 명중하지 않았습니다.'
    );
    insert into public.investment_shop_messages(client_id, message)
    values (
      p_target_client_id,
      v_name || ' 공격을 받았지만 회피했습니다. '
        || '누군가가 당신을 맞힐 뻔했습니다.'
    );
    return jsonb_build_object(
      'success', false,
      'message', v_name || '을(를) 발사했지만 ' || v_target_name || '에게 명중하지 않았습니다.'
    );
  end if;

  select u.cash + coalesce((
    select sum(h.quantity * a.current_price)
    from public.investment_holdings h
    join public.investment_assets a on a.symbol = h.symbol
    where h.client_id = u.client_id and a.listed
  ), 0)
  into v_total
  from public.investment_users u
  where u.client_id = p_target_client_id;

  v_remaining := greatest(1, round(v_total * v_damage));
  select cash into v_old_cash
  from public.investment_users
  where client_id = p_target_client_id
  for update;
  v_cash_loss := least(v_old_cash, v_remaining);
  update public.investment_users
  set cash = cash - v_cash_loss
  where client_id = p_target_client_id;
  v_remaining := v_remaining - v_cash_loss;
  v_actual_loss := v_cash_loss;

  for holding_row in
    select h.client_id, h.symbol, h.quantity, h.invested_amount, a.current_price
    from public.investment_holdings h
    join public.investment_assets a on a.symbol = h.symbol
    where h.client_id = p_target_client_id
      and h.quantity > 0
      and a.listed
    order by h.quantity * a.current_price desc
    for update of h
  loop
    exit when v_remaining <= 0;
    v_remove_quantity := least(
      holding_row.quantity,
      ceil(v_remaining::numeric / greatest(holding_row.current_price, 1))::bigint
    );
    v_removed_value := least(v_remaining, v_remove_quantity * holding_row.current_price);
    update public.investment_holdings
    set quantity = quantity - v_remove_quantity,
        invested_amount = greatest(
          0,
          invested_amount - round(
            invested_amount * v_remove_quantity::numeric
            / greatest(holding_row.quantity, 1)
          )
        )
    where client_id = holding_row.client_id
      and symbol = holding_row.symbol;
    v_remaining := v_remaining - v_removed_value;
    v_actual_loss := v_actual_loss + v_removed_value;
  end loop;

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_target_client_id,
    v_name || ' 피격! 자산이 '
      || to_char(v_actual_loss, 'FM999,999,999,999,999,999,999')
      || '원 감소했습니다.'
  );

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_client_id,
    v_name || ' 발사 성공! ' || v_target_name || '의 자산 '
      || to_char(v_actual_loss, 'FM999,999,999,999,999,999,999')
      || '원을 감소시켰습니다.'
  );

  return jsonb_build_object(
    'success', true,
    'message', v_name || ' 명중! ' || v_target_name || '의 자산 '
      || to_char(v_actual_loss, 'FM999,999,999,999,999,999,999')
      || '원이 감소했습니다.'
  );
end;
$$;

-- 계정 연결 시 투자정보와 상점 아이템·메시지를 함께 이전
create or replace function public.investment_link_account(
  p_session_token uuid,
  p_old_client_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  old_user public.investment_users%rowtype;
  target_user public.investment_users%rowtype;
begin
  select s.account_id
  into v_account_id
  from public.site_account_sessions s
  where s.token = p_session_token
    and s.expires_at > now()
  for update;

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  if p_old_client_id is null
     or p_old_client_id = v_account_id then
    return true;
  end if;

  select *
  into old_user
  from public.investment_users
  where client_id = p_old_client_id
  for update;

  if old_user.client_id is null then
    return true;
  end if;

  select *
  into target_user
  from public.investment_users
  where client_id = v_account_id
  for update;

  if target_user.client_id is null then
    if exists (
      select 1
      from public.investment_users
      where nickname = old_user.nickname
        and client_id <> p_old_client_id
    ) then
      raise exception '기존 닉네임이 이미 사용 중이어서 투자 정보를 연동할 수 없습니다.';
    end if;
    insert into public.investment_users (client_id, nickname, cash)
    values (v_account_id, old_user.nickname, old_user.cash);
  else
    if target_user.nickname <> old_user.nickname
       and exists (
         select 1
         from public.investment_users
         where nickname = old_user.nickname
           and client_id <> p_old_client_id
       ) then
      raise exception '기존 닉네임이 이미 사용 중이어서 투자 정보를 연동할 수 없습니다.';
    end if;
    update public.investment_users
    set nickname = old_user.nickname,
        cash = target_user.cash + old_user.cash
    where client_id = v_account_id;
  end if;

  insert into public.investment_holdings (
    client_id, symbol, quantity, invested_amount
  )
  select v_account_id, symbol, quantity, invested_amount
  from public.investment_holdings
  where client_id = p_old_client_id
  on conflict (client_id, symbol)
  do update set
    quantity = public.investment_holdings.quantity + excluded.quantity,
    invested_amount =
      public.investment_holdings.invested_amount + excluded.invested_amount;

  insert into public.investment_shop_items (
    client_id, item_type, quantity
  )
  select v_account_id, item_type, quantity
  from public.investment_shop_items
  where client_id = p_old_client_id
  on conflict (client_id, item_type)
  do update set
    quantity = public.investment_shop_items.quantity + excluded.quantity;

  update public.investment_shop_messages
  set client_id = v_account_id
  where client_id = p_old_client_id;

  delete from public.investment_holdings
  where client_id = p_old_client_id;

  delete from public.investment_shop_items
  where client_id = p_old_client_id;

  delete from public.investment_users
  where client_id = p_old_client_id;

  return true;
end;
$$;

revoke all on function public.shop_get_state(uuid) from public;
revoke all on function public.shop_get_unread_count(uuid) from public;
revoke all on function public.shop_get_messages(uuid) from public;
revoke all on function public.shop_purchase(uuid, text, bigint) from public;
revoke all on function public.shop_purchase(uuid, text) from public;
revoke all on function public.shop_use_missile(uuid, text, uuid) from public;
revoke all on function public.shop_send_letter(uuid, uuid, text) from public;
revoke all on function public.shop_change_nickname(uuid, uuid, text) from public;
revoke all on function public.investment_link_account(uuid, uuid) from public;
grant execute on function public.shop_get_state(uuid) to anon, authenticated;
grant execute on function public.shop_get_state(uuid, text) to anon, authenticated;
grant execute on function public.shop_get_unread_count(uuid) to anon, authenticated;
grant execute on function public.shop_get_messages(uuid) to anon, authenticated;
grant execute on function public.shop_purchase(uuid, text, bigint) to anon, authenticated;
grant execute on function public.shop_purchase(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
grant execute on function public.shop_use_missile(uuid, text, uuid) to anon, authenticated;
grant execute on function public.shop_send_letter(uuid, uuid, text) to anon, authenticated;
grant execute on function public.shop_change_nickname(uuid, uuid, text) to anon, authenticated;
grant execute on function public.investment_link_account(uuid, uuid) to anon, authenticated;

drop function if exists public.site_account_delete(uuid, text);

create or replace function public.site_account_delete(
  p_session_token uuid,
  p_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_password_hash text;
begin
  select s.account_id, a.password_hash
  into v_account_id, v_password_hash
  from public.site_account_sessions s
  join public.site_accounts a
    on a.id = s.account_id
  where s.token = p_session_token
    and s.expires_at > now()
  for update of a;

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  if p_password is null
     or v_password_hash <> crypt(p_password, v_password_hash) then
    raise exception '비밀번호가 올바르지 않습니다.';
  end if;

  delete from public.investment_holdings
  where client_id = v_account_id;

  delete from public.investment_users
  where client_id = v_account_id;

  delete from public.site_accounts
  where id = v_account_id;

  return true;
end;
$$;

revoke all on function public.site_account_delete(uuid, text)
from public;

grant execute on function public.site_account_delete(uuid, text)
to anon, authenticated;

-- Compatibility fix for databases that still have the old integer overload.
drop function if exists public.investment_next_direction(integer, integer);

create or replace function public.investment_next_direction(
  p_previous_pct numeric,
  p_daily_direction integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_previous_pct <= -10 and random() < 0.7 then
    return 1;
  end if;

  if p_previous_pct = 0 then
    return p_daily_direction;
  end if;

  if random() < 0.7 then
    return sign(p_previous_pct)::integer;
  end if;

  return -sign(p_previous_pct)::integer;
end;
$$;

revoke all on function public.investment_next_direction(numeric, integer)
from public;

grant execute on function public.investment_next_direction(numeric, integer)
to anon, authenticated;
