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
  last_market_date date
);

create table if not exists public.investment_assets (
  symbol text primary key,
  name text not null,
  base_price bigint not null check (base_price > 0),
  current_price bigint not null check (current_price >= 0),
  change_pct numeric not null default 0,
  listed boolean not null default true
);

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
  today date := (now() at time zone 'Asia/Seoul')::date;
  previous_date date;
  asset record;
  pct numeric;
  pct_two numeric;
  direction integer;
  next_price bigint;
begin
  insert into public.investment_market (id, last_market_date)
  values (1, null)
  on conflict (id) do nothing;

  select last_market_date into previous_date
  from public.investment_market
  where id = 1
  for update;

  if previous_date is not distinct from today then
    return today;
  end if;

  for asset in select * from public.investment_assets order by symbol for update loop
    if asset.symbol in ('JEONGMIN_ROCKET', 'SEOK_HYNIX') then
      continue;
    end if;
    if not asset.listed then
      update public.investment_assets
      set current_price = base_price, change_pct = 0, listed = true
      where symbol = asset.symbol;
      continue;
    end if;

    pct := 0;
    if asset.symbol in ('SANGI_ROCKET', 'JEONGMIN_ROCKET') then
      if random() < 0.10 then
        pct := floor(random() * 101) + 100;
        pct_two := floor(random() * 101) + 100;
      else
        direction := case when random() < 0.5 then -1 else 1 end;
        pct := direction * (floor(random() * 30) + 1);
        pct_two := direction * (floor(random() * 30) + 1);
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol in ('SAMSUNG_MICROWAVE', 'SEOK_HYNIX') then
      direction := case when random() < 0.5 then -1 else 1 end;
      pct := direction * (floor(random() * 15) + 1);
      pct_two := direction * (floor(random() * 15) + 1);
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'SANGI_BIO' then
      if random() < 0.05 then
        pct := floor(random() * 501) + 500;
      else
        pct := (case when random() < 0.5 then -1 else 1 end) * (floor(random() * 30) + 1);
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'SURGE_STOCK' then
      pct := case when random() < 0.5
        then -(floor(random() * 99) + 1)
        else floor(random() * 2001) + 1
      end;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'KOREA_SANGI_INDEX' then
      pct := case when random() < 0.5
        then -(floor(random() * 1) + 1)
        else floor(random() * 3) + 1
      end;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'SANGI_AI' then
      pct := case when random() < 0.5
        then -(floor(random() * 10) + 1)
        else floor(random() * 20) + 1
      end;
      next_price := round(asset.current_price * (1 + pct / 100));
    else
      if random() < 0.05 then
        pct := floor(random() * 101) + 100;
      else
        pct := (case when random() < 0.5 then -1 else 1 end) * (floor(random() * 30) + 1);
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    end if;

    update public.investment_assets
    set current_price = case when next_price < 100 then 0 else next_price end,
        change_pct = pct,
        listed = next_price >= 100
    where symbol = asset.symbol;

    if next_price < 100 then
      delete from public.investment_holdings where symbol = asset.symbol;
    end if;

    if asset.symbol = 'SANGI_ROCKET' then
      update public.investment_assets
      set current_price = case when round(current_price * (1 + pct_two / 100)) < 100 then 0 else round(current_price * (1 + pct_two / 100)) end,
          change_pct = pct_two,
          listed = round(current_price * (1 + pct_two / 100)) >= 100
      where symbol = 'JEONGMIN_ROCKET';
    elsif asset.symbol = 'SAMSUNG_MICROWAVE' then
      update public.investment_assets
      set current_price = case when round(current_price * (1 + pct_two / 100)) < 100 then 0 else round(current_price * (1 + pct_two / 100)) end,
          change_pct = pct_two,
          listed = round(current_price * (1 + pct_two / 100)) >= 100
      where symbol = 'SEOK_HYNIX';
    end if;
  end loop;

  update public.investment_market set last_market_date = today where id = 1;
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
    'total_asset', u.cash + coalesce((
      select sum(h.quantity * a.current_price)
      from public.investment_holdings h
      join public.investment_assets a on a.symbol = h.symbol
      where h.client_id = u.client_id and a.listed
    ), 0),
    'market_date', (select last_market_date from public.investment_market where id = 1),
    'assets', coalesce((select jsonb_agg(to_jsonb(a) order by a.symbol) from public.investment_assets a), '[]'::jsonb),
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

  return true;
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

create or replace function public.investment_trade(
  p_client_id uuid,
  p_symbol text,
  p_side text,
  p_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row public.investment_users%rowtype;
  asset_row public.investment_assets%rowtype;
  current_quantity integer;
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
revoke all on function public.investment_trade(uuid, text, text, integer) from public;
revoke all on function public.investment_admin_grant_cash(text, uuid, bigint) from public;
revoke all on function public.investment_admin_adjust_cash(text, uuid, bigint) from public;
grant execute on function public.investment_get_state(uuid, text) to anon;
grant execute on function public.investment_trade(uuid, text, text, integer) to anon;
grant execute on function public.investment_admin_grant_cash(text, uuid, bigint) to anon;
grant execute on function public.investment_admin_adjust_cash(text, uuid, bigint) to anon;
