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
alter table public.comments add column if not exists author_account_id uuid;
alter table public.comments add column if not exists investor_level integer;
alter table public.comments add column if not exists upvotes bigint not null default 0;
alter table public.comments add column if not exists downvotes bigint not null default 0;

create or replace function public.create_investor_comment(
  p_session_token uuid,
  p_body text
)
returns public.comments
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_nickname text;
  v_level integer;
  v_comment public.comments;
begin
  select s.account_id
  into v_account_id
  from public.site_account_sessions s
  where s.token = p_session_token
    and s.expires_at > now();

  if v_account_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select nickname into v_nickname
  from public.investment_users
  where client_id = v_account_id;

  if v_nickname is null then
    raise exception '투자자 닉네임을 먼저 설정하세요.';
  end if;

  select player_level into v_level
  from public.sanggi_game_states
  where account_id = v_account_id;

  insert into public.comments (
    nickname, body, password_hash, author_account_id, investor_level
  )
  values (
    v_nickname, trim(p_body), encode(digest(p_session_token::text, 'sha256'), 'hex'),
    v_account_id, greatest(coalesce(v_level, 1), 1)
  )
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke all on function public.create_investor_comment(uuid, text) from public;
grant execute on function public.create_investor_comment(uuid, text) to anon, authenticated;

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

create table if not exists public.comment_votes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  voter_key text not null check (char_length(voter_key) between 16 and 128),
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_key)
);

alter table public.comment_votes enable row level security;
revoke all on table public.comment_votes from anon, authenticated;

create or replace function public.comment_vote(
  p_comment_id uuid,
  p_voter_key text,
  p_vote smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote smallint;
  v_upvotes bigint;
  v_downvotes bigint;
begin
  if p_vote not in (-1, 1) then
    raise exception '잘못된 투표입니다.';
  end if;
  if p_voter_key is null or char_length(trim(p_voter_key)) < 16 then
    raise exception '투표 식별자가 필요합니다.';
  end if;
  if not exists (select 1 from public.comments where id = p_comment_id) then
    raise exception '존재하지 않는 댓글입니다.';
  end if;

  select vote into v_vote
  from public.comment_votes
  where comment_id = p_comment_id and voter_key = p_voter_key;

  if v_vote = p_vote then
    delete from public.comment_votes
    where comment_id = p_comment_id and voter_key = p_voter_key;
    v_vote := null;
  else
    insert into public.comment_votes(comment_id, voter_key, vote)
    values (p_comment_id, trim(p_voter_key), p_vote)
    on conflict (comment_id, voter_key)
    do update set vote = excluded.vote;
    v_vote := p_vote;
  end if;

  select count(*) filter (where vote = 1), count(*) filter (where vote = -1)
  into v_upvotes, v_downvotes
  from public.comment_votes
  where comment_id = p_comment_id;

  update public.comments
  set upvotes = v_upvotes, downvotes = v_downvotes
  where id = p_comment_id;

  return jsonb_build_object(
    'vote', v_vote,
    'upvotes', v_upvotes,
    'downvotes', v_downvotes
  );
end;
$$;

revoke all on function public.comment_vote(uuid, text, smallint) from public;
grant execute on function public.comment_vote(uuid, text, smallint) to anon, authenticated;

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

create or replace function public.delete_investor_comment(
  p_id uuid,
  p_session_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id
  into v_account_id
  from public.site_account_sessions
  where token = p_session_token
    and expires_at > now();

  if v_account_id is null then
    return false;
  end if;

  delete from public.comments
  where id = p_id
    and author_account_id = v_account_id;

  return found;
end;
$$;

revoke all on function public.delete_investor_comment(uuid, uuid) from public;
grant execute on function public.delete_investor_comment(uuid, uuid) to anon, authenticated;

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
  quantity bigint not null default 0 check (quantity >= 0),
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
  ('JAEJJING_SURGE_STOCK', '재찡급등주', 1000, 1000),
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
  next_price_two bigint;
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
      'JAEJJING_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
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

  perform set_config('app.investment_admin_reset', 'on', true);
  update public.investment_assets
  set current_price = base_price,
      change_pct = 0,
      listed = true,
      delisted_at = null,
      was_delisted = true
  where listed = false
    and (
      delisted_at is null
      or delisted_at <= now() - interval '5 minutes'
    );
  perform set_config('app.investment_admin_reset', 'off', true);

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
      'JUSEONG_SURGE_STOCK',
            'JAEJJING_SURGE_STOCK'
    ) then
      daily_direction := coalesce((direction_state_value->>asset.symbol)::integer, case when random() < 0.5 then -1 else 1 end);
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
      if asset.listed then
        insert into public.investment_shop_messages(client_id, message)
        select
          h.client_id,
          '보유하고 있던 ' || a.name || ' 종목이 상장폐지되었습니다. 보유 수량 '
            || to_char(h.quantity, 'FM999,999,999,999,999,999,999')
            || '주는 정리되었습니다.'
        from public.investment_holdings h
        join public.investment_assets a on a.symbol = h.symbol
        where h.symbol = asset.symbol
          and h.quantity > 0;
      end if;
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

      next_price_two := round(
        (select current_price from public.investment_assets where symbol = 'JEONGMIN_ROCKET')
        * (1 + pct_two / 100)
      );
      if next_price_two <= 10 then
        insert into public.investment_shop_messages(client_id, message)
        select
          h.client_id,
          '보유하고 있던 ' || a.name || ' 종목이 상장폐지되었습니다. 보유 수량 '
            || to_char(h.quantity, 'FM999,999,999,999,999,999,999')
            || '주는 정리되었습니다.'
        from public.investment_holdings h
        join public.investment_assets a on a.symbol = h.symbol
        where h.symbol = 'JEONGMIN_ROCKET'
          and h.quantity > 0
          and exists (
            select 1
            from public.investment_assets
            where symbol = 'JEONGMIN_ROCKET'
              and listed = true
          );
      end if;
      update public.investment_assets
      set current_price = case when next_price_two <= 10 then 0 else next_price_two end,
          change_pct = pct_two,
          listed = next_price_two > 10
      where symbol = 'JEONGMIN_ROCKET';
      if next_price_two <= 10 then
        delete from public.investment_holdings
        where symbol = 'JEONGMIN_ROCKET';
      end if;
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
      select jsonb_agg(jsonb_build_object(
        'client_id', r.client_id,
        'nickname', r.nickname,
        'player_level', r.player_level,
        'total_asset', r.total_asset
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
        left join public.sanggi_game_states sgs
          on sgs.account_id = iu.client_id
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

  insert into public.investment_shop_messages(
    client_id, sender_name, message_body, message
  )
  values (
    p_target_client_id,
    '관리자',
    to_char(p_amount, 'FM999,999,999,999,999,999,999')
      || '원을 지급했습니다.',
    '관리자가 ' || to_char(p_amount, 'FM999,999,999,999,999,999,999')
      || '원을 지급했습니다.'
  );

  return true;
end;
$$;

create or replace function public.investment_admin_grant_cash_to_all(
  p_admin_password text,
  p_amount bigint,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_count integer;
  v_message text;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_amount is null or p_amount < 1 then
    raise exception '지급액은 1원 이상이어야 합니다.';
  end if;

  if p_message is null or char_length(trim(p_message)) < 1 then
    raise exception '전달할 메시지를 입력하세요.';
  end if;

  if char_length(trim(p_message)) > 500 then
    raise exception '메시지는 500자 이하로 입력하세요.';
  end if;

  v_message := '모든 유저에게 '
    || to_char(p_amount, 'FM999,999,999,999,999,999,999')
    || '원을 지급했습니다.' || E'\n' || trim(p_message);

  update public.investment_users
  set cash = cash + p_amount
  where client_id is not null;

  get diagnostics v_user_count = row_count;

  insert into public.investment_shop_messages(client_id, sender_name, message_body, message)
  select client_id, '관리자', v_message, '관리자가 ' || v_message
  from public.investment_users;

  return jsonb_build_object(
    'user_count', v_user_count,
    'message', v_message
  );
end;
$$;

create or replace function public.investment_admin_get_users(
  p_admin_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'client_id', client_id,
        'nickname', nickname
      )
      order by nickname
    )
    from public.investment_users
  ), '[]'::jsonb);
end;
$$;

create or replace function public.investment_admin_grant_item(
  p_admin_password text,
  p_target_client_id uuid,
  p_item_type text,
  p_quantity bigint,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_name text;
  v_message text;
  v_user_count integer;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_item_type not in (
    'low_missile', 'mid_missile', 'high_missile', 'nuclear_missile',
    'missile_shield', 'nickname_ticket', 'letter',
    'megaphone',
    'gambling_box',
    'normal_potion', 'advanced_potion', 'legendary_potion',
    'sanggi_hanbok', 'sanggi_spacesuit', 'juseong_hanbok',
    'juseong_spacesuit', 'cash_box', 'weird_cash_box'
  ) then
    raise exception '지급할 수 없는 아이템입니다.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception '수량은 1개 이상 1,000,000개 이하로 입력하세요.';
  end if;

  if p_message is null or char_length(trim(p_message)) < 1 then
    raise exception '전달할 메시지를 입력하세요.';
  end if;

  if char_length(trim(p_message)) > 500 then
    raise exception '메시지는 500자 이하로 입력하세요.';
  end if;

  v_item_name := case p_item_type
    when 'low_missile' then '하급 미사일'
    when 'mid_missile' then '중급 미사일'
    when 'high_missile' then '고급 미사일'
    when 'nuclear_missile' then '핵 미사일'
    when 'missile_shield' then '미사일 방어막'
    when 'nickname_ticket' then '닉네임 변경권'
    when 'letter' then '편지'
    when 'megaphone' then '확성기'
    when 'gambling_box' then '도박 중독자 상자'
    when 'gambling_box' then '도박 중독자 상자'
    when 'normal_potion' then '일반 물약'
    when 'advanced_potion' then '고급 물약'
    when 'legendary_potion' then '전설 물약'
    when 'sanggi_hanbok' then '상기 한복'
    when 'sanggi_spacesuit' then '상기 우주복'
    when 'juseong_hanbok' then '주성 한복'
    when 'juseong_spacesuit' then '주성 우주복'
    when 'cash_box' then '랜덤 현금 박스'
    when 'weird_cash_box' then '이상한 랜덤 현금 박스'
  end;

  if p_target_client_id is not null
    and not exists (
      select 1 from public.investment_users
      where client_id = p_target_client_id
    ) then
    raise exception '지급할 유저를 찾을 수 없습니다.';
  end if;

  insert into public.investment_shop_items(client_id, item_type, quantity)
  select u.client_id, p_item_type, p_quantity
  from public.investment_users u
  where p_target_client_id is null or u.client_id = p_target_client_id
  on conflict (client_id, item_type)
  do update set
    quantity = public.investment_shop_items.quantity + excluded.quantity;

  get diagnostics v_user_count = row_count;

  v_message := v_item_name || ' ' || p_quantity
    || '개를 지급했습니다.' || E'\n' || trim(p_message);

  insert into public.investment_shop_messages(client_id, sender_name, message_body, message)
  select u.client_id, '관리자', v_message, '관리자가 ' || v_message
  from public.investment_users u
  where p_target_client_id is null or u.client_id = p_target_client_id;

  return jsonb_build_object(
    'user_count', v_user_count,
    'item_type', p_item_type,
    'quantity', p_quantity,
    'message', v_message
  );
end;
$$;

create or replace function public.investment_admin_remove_item(
  p_admin_password text,
  p_target_client_id uuid,
  p_item_type text,
  p_quantity bigint,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_name text;
  v_owned_quantity bigint;
  v_message text;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_target_client_id is not null
     and not exists (
       select 1 from public.investment_users
       where client_id = p_target_client_id
     ) then
    raise exception '차감할 유저를 찾을 수 없습니다.';
  end if;

  if p_item_type not in (
    'low_missile', 'mid_missile', 'high_missile', 'nuclear_missile',
    'missile_shield', 'nickname_ticket', 'letter',
    'megaphone',
    'gambling_box',
    'normal_potion', 'advanced_potion', 'legendary_potion',
    'sanggi_hanbok', 'sanggi_spacesuit', 'juseong_hanbok',
    'juseong_spacesuit', 'cash_box', 'weird_cash_box'
  ) then
    raise exception '차감할 수 없는 아이템입니다.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception '수량은 1개 이상 1,000,000개 이하로 입력하세요.';
  end if;

  if p_message is null or char_length(trim(p_message)) < 1 then
    raise exception '전달할 메시지를 입력하세요.';
  end if;

  if char_length(trim(p_message)) > 500 then
    raise exception '메시지는 500자 이하로 입력하세요.';
  end if;

  v_item_name := case p_item_type
    when 'low_missile' then '하급 미사일'
    when 'mid_missile' then '중급 미사일'
    when 'high_missile' then '고급 미사일'
    when 'nuclear_missile' then '핵 미사일'
    when 'missile_shield' then '미사일 방어막'
    when 'nickname_ticket' then '닉네임 변경권'
    when 'letter' then '편지'
    when 'megaphone' then '확성기'
    when 'gambling_box' then '도박 중독자 상자'
    when 'normal_potion' then '일반 물약'
    when 'advanced_potion' then '고급 물약'
    when 'legendary_potion' then '전설 물약'
    when 'sanggi_hanbok' then '상기 한복'
    when 'sanggi_spacesuit' then '상기 우주복'
    when 'juseong_hanbok' then '주성 한복'
    when 'juseong_spacesuit' then '주성 우주복'
    when 'cash_box' then '랜덤 현금 박스'
    when 'weird_cash_box' then '이상한 랜덤 현금 박스'
  end;

  if p_target_client_id is not null then
    select quantity into v_owned_quantity
    from public.investment_shop_items
    where client_id = p_target_client_id and item_type = p_item_type
    for update;

    if coalesce(v_owned_quantity, 0) < p_quantity then
      raise exception '해당 유저의 보유 수량이 부족합니다.';
    end if;
  else
    if exists (
      select 1
      from public.investment_users u
      left join public.investment_shop_items i
        on i.client_id = u.client_id and i.item_type = p_item_type
      where coalesce(i.quantity, 0) < p_quantity
    ) then
      raise exception '모든 유저가 해당 수량을 보유하고 있지 않습니다.';
    end if;
  end if;

  update public.investment_shop_items
  set quantity = quantity - p_quantity
  where item_type = p_item_type
    and (p_target_client_id is null or client_id = p_target_client_id);

  delete from public.investment_shop_items
  where item_type = p_item_type
    and quantity <= 0
    and (p_target_client_id is null or client_id = p_target_client_id);

  v_message := v_item_name || ' ' || p_quantity
    || '개를 차감했습니다.' || E'\n' || trim(p_message);

  insert into public.investment_shop_messages(client_id, sender_name, message_body, message)
  select client_id, '관리자', v_message, '관리자가 ' || v_message
  from public.investment_users
  where p_target_client_id is null or client_id = p_target_client_id;

  return jsonb_build_object(
    'user_count', (select count(*) from public.investment_users
      where p_target_client_id is null or client_id = p_target_client_id),
    'item_type', p_item_type,
    'quantity', p_quantity,
    'message', v_message
  );
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
  if (asset_row.current_price::numeric * p_quantity::numeric) > 9223372036854775807 then
    raise exception '거래 금액이 너무 큽니다.';
  end if;
  total_price := asset_row.current_price * p_quantity;
  select coalesce(quantity, 0), coalesce(invested_amount, 0)
  into current_quantity, current_invested
  from public.investment_holdings
  where client_id = p_client_id and symbol = p_symbol;

  if p_side = 'buy' then
    if user_row.cash < total_price then raise exception '보유 현금이 부족합니다.'; end if;
    if (current_quantity::numeric + p_quantity::numeric) > 9223372036854775807 then
      raise exception '보유 주식 수량이 너무 큽니다.';
    end if;
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
revoke all on function public.investment_admin_grant_cash_to_all(text, bigint, text) from public;
revoke all on function public.investment_admin_get_users(text) from public;
revoke all on function public.investment_admin_grant_item(text, uuid, text, bigint, text) from public;
revoke all on function public.investment_admin_remove_item(text, uuid, text, bigint, text) from public;
revoke all on function public.investment_admin_adjust_cash(text, uuid, bigint) from public;
grant execute on function public.investment_get_state(uuid, text) to anon;
grant execute on function public.investment_trade(uuid, text, text, bigint) to anon;
grant execute on function public.investment_admin_grant_cash(text, uuid, bigint) to anon;
grant execute on function public.investment_admin_grant_cash_to_all(text, bigint, text) to anon;
grant execute on function public.investment_admin_get_users(text) to anon, authenticated;
grant execute on function public.investment_admin_grant_item(text, uuid, text, bigint, text) to anon, authenticated;
grant execute on function public.investment_admin_remove_item(text, uuid, text, bigint, text) to anon, authenticated;
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
       'JEONGMIN_SURGE_STOCK', 'JUSEONG_SURGE_STOCK', 'JAEJJING_SURGE_STOCK'
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
            'JUSEONG_SURGE_STOCK',
            'JAEJJING_SURGE_STOCK'
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
            'JAEJJING_SURGE_STOCK',
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
      'JUSEONG_SURGE_STOCK',
            'JAEJJING_SURGE_STOCK'
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
  perform set_config('app.investment_admin_reset', 'on', true);
  update public.investment_assets
  set current_price = base_price,
      change_pct = 0,
      listed = true,
      delisted_at = null,
      was_delisted = true
  where listed = false
    and (
      delisted_at is null
      or delisted_at <= now() - interval '5 minutes'
    );

  perform set_config('app.investment_admin_reset', 'off', true);
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
  item_type text not null check (item_type in ('low_missile', 'mid_missile', 'high_missile', 'nuclear_missile', 'missile_shield', 'nickname_ticket', 'letter')),
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
    'nuclear_missile',
    'missile_shield',
    'nickname_ticket',
    'letter',
    'megaphone',
    'normal_potion',
    'advanced_potion',
    'legendary_potion',
    'sanggi_hanbok',
    'sanggi_spacesuit',
    'juseong_hanbok',
    'juseong_spacesuit',
    'cash_box',
    'weird_cash_box',
    'gambling_box'
  ));

create table if not exists public.investment_shop_daily_limits (
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  limit_date date not null,
  gambling_box_quantity bigint not null default 0 check (gambling_box_quantity >= 0),
  primary key (client_id, limit_date)
);

alter table public.investment_shop_daily_limits enable row level security;
revoke all on table public.investment_shop_daily_limits from anon, authenticated;

create table if not exists public.investment_shop_messages (
  id bigint generated by default as identity primary key,
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.investment_shop_messages
  add column if not exists sender_name text;
alter table public.investment_shop_messages
  add column if not exists message_body text;

alter table public.investment_shop_messages enable row level security;
revoke all on table public.investment_shop_messages from anon, authenticated;

create table if not exists public.investment_daily_shop_rewards (
  reward_date date not null,
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  primary key (reward_date, client_id)
);

alter table public.investment_daily_shop_rewards enable row level security;
revoke all on table public.investment_daily_shop_rewards from anon, authenticated;

create or replace function public.investment_daily_shop_reward_tick(
  p_reward_date date default (now() at time zone 'Asia/Seoul')::date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_reward_count integer := 0;
begin
  for v_user in
    select client_id
    from public.investment_users
  loop
    insert into public.investment_daily_shop_rewards(reward_date, client_id)
    values (p_reward_date, v_user.client_id)
    on conflict (reward_date, client_id) do nothing;

    if found then
      insert into public.investment_shop_items(client_id, item_type, quantity)
      values
        (v_user.client_id, 'weird_cash_box', 3),
        (v_user.client_id, 'cash_box', 3)
      on conflict (client_id, item_type)
      do update set
        quantity = public.investment_shop_items.quantity + excluded.quantity;

      insert into public.investment_shop_messages(client_id, message)
      values (
        v_user.client_id,
        '일일 보상으로 이상한 랜덤 현금 박스 3개와 랜덤 현금 박스 3개가 지급되었습니다.'
      );
      v_reward_count := v_reward_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'reward_date', p_reward_date,
    'user_count', v_reward_count
  );
end;
$$;

revoke all on function public.investment_daily_shop_reward_tick(date) from public;

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
        'sender_name', coalesce(sender_name, '시스템'),
        'message', coalesce(message_body, message),
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
          when 'nuclear_missile' then '핵 미사일'
          when 'missile_shield' then '미사일 방어막'
          when 'nickname_ticket' then '닉네임 변경권'
          when 'letter' then '편지'
          when 'megaphone' then '확성기'
          when 'normal_potion' then '일반 물약'
          when 'advanced_potion' then '고급 물약'
          when 'legendary_potion' then '전설 물약'
          when 'sanggi_hanbok' then '상기 한복'
          when 'sanggi_spacesuit' then '상기 우주복'
          when 'juseong_hanbok' then '주성 한복'
          when 'juseong_spacesuit' then '주성 우주복'
          when 'cash_box' then '랜덤 현금 박스'
          when 'weird_cash_box' then '이상한 랜덤 현금 박스'
          when 'gambling_box' then '도박 중독자 상자'
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
          when 'nuclear_missile' then '핵 미사일'
          when 'missile_shield' then '미사일 방어막'
          when 'nickname_ticket' then '닉네임 변경권'
          when 'letter' then '편지'
          when 'megaphone' then '확성기'
          when 'normal_potion' then '일반 물약'
          when 'advanced_potion' then '고급 물약'
          when 'legendary_potion' then '전설 물약'
          when 'sanggi_hanbok' then '상기 한복'
          when 'sanggi_spacesuit' then '상기 우주복'
          when 'juseong_hanbok' then '주성 한복'
          when 'juseong_spacesuit' then '주성 우주복'
          when 'cash_box' then '랜덤 현금 박스'
          when 'weird_cash_box' then '이상한 랜덤 현금 박스'
          when 'gambling_box' then '도박 중독자 상자'
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
  v_owned_quantity bigint;
  v_limit_date date;
  v_daily_quantity bigint;
begin
  select price, name into v_price, v_name
  from (values
    ('low_missile', 20000000::bigint, '하급 미사일'),
    ('mid_missile', 50000000::bigint, '중급 미사일'),
    ('high_missile', 150000000::bigint, '고급 미사일'),
    ('nuclear_missile', 10000000000::bigint, '핵 미사일'),
    ('missile_shield', 10000000::bigint, '미사일 방어막'),
    ('nickname_ticket', 5000000000::bigint, '닉네임 변경권'),
    ('megaphone', 50000::bigint, '확성기'),
    ('normal_potion', 10000000::bigint, '일반 물약'),
    ('advanced_potion', 100000000::bigint, '고급 물약'),
    ('legendary_potion', 1000000000::bigint, '전설 물약'),
    ('sanggi_hanbok', 1000000::bigint, '상기 한복'),
    ('sanggi_spacesuit', 10000000::bigint, '상기 우주복'),
    ('juseong_hanbok', 2000000::bigint, '주성 한복'),
    ('juseong_spacesuit', 20000000::bigint, '주성 우주복'),
    ('letter', 10000::bigint, '편지')
    ,('gambling_box', 1::bigint, '도박 중독자 상자')
  ) items(item_type, price, name)
  where item_type = p_item_type;

  if v_price is null then
    raise exception '존재하지 않는 상품입니다.';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception '구매 수량은 1개 이상이어야 합니다.';
  end if;

  if p_item_type = 'gambling_box' then
    v_limit_date := (now() at time zone 'Asia/Seoul')::date;

    insert into public.investment_shop_daily_limits (
      client_id,
      limit_date,
      gambling_box_quantity
    )
    values (p_client_id, v_limit_date, 0)
    on conflict (client_id, limit_date) do nothing;

    select gambling_box_quantity
    into v_daily_quantity
    from public.investment_shop_daily_limits
    where client_id = p_client_id
      and limit_date = v_limit_date
    for update;

    if v_daily_quantity + p_quantity > 3 then
      raise exception '도박 중독자 상자는 하루에 최대 3개까지만 구매할 수 있습니다. 현재 남은 구매 가능 수량: %개.',
        greatest(0, 3 - v_daily_quantity);
    end if;
  end if;

  select quantity
  into v_owned_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
  for update;

  if coalesce(v_owned_quantity, 0) + p_quantity > 100 then
    raise exception '아이템은 한 종류당 최대 100개까지 보유할 수 있습니다.';
  end if;
  if p_item_type in ('sanggi_hanbok', 'sanggi_spacesuit', 'juseong_hanbok', 'juseong_spacesuit')
    and coalesce(v_owned_quantity, 0) >= 1 then
    raise exception '이미 구매한 의상입니다.';
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

  if p_item_type = 'gambling_box' then
    update public.investment_shop_daily_limits
    set gambling_box_quantity = gambling_box_quantity + p_quantity
    where client_id = p_client_id
      and limit_date = v_limit_date;
  end if;

  if p_item_type = 'normal_potion' then
    insert into public.sanggi_game_states (account_id, normal_potions)
    values (p_client_id, p_quantity)
    on conflict (account_id) do update
      set normal_potions = least(100, public.sanggi_game_states.normal_potions + excluded.normal_potions),
          updated_at = now();
  elsif p_item_type = 'advanced_potion' then
    insert into public.sanggi_game_states (account_id, advanced_potions)
    values (p_client_id, p_quantity)
    on conflict (account_id) do update
      set advanced_potions = least(100, public.sanggi_game_states.advanced_potions + excluded.advanced_potions),
          updated_at = now();
  elsif p_item_type = 'legendary_potion' then
    insert into public.sanggi_game_states (account_id, legendary_potions)
    values (p_client_id, p_quantity)
    on conflict (account_id) do update
      set legendary_potions = least(100, public.sanggi_game_states.legendary_potions + excluded.legendary_potions),
          updated_at = now();
  end if;

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

create or replace function public.shop_use_megaphone(
  p_client_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity bigint;
  v_nickname text;
  v_message text := trim(p_message);
  v_user_count integer;
begin
  if v_message is null or char_length(v_message) < 1 then
    raise exception '전달할 메시지를 입력하세요.';
  end if;
  if char_length(v_message) > 500 then
    raise exception '메시지는 500자 이하로 입력하세요.';
  end if;

  select nickname into v_nickname
  from public.investment_users
  where client_id = p_client_id
  for update;
  if v_nickname is null then
    raise exception '먼저 투자 닉네임을 설정하세요.';
  end if;

  select quantity into v_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'megaphone'
  for update;
  if coalesce(v_quantity, 0) < 1 then
    raise exception '가방에 확성기가 없습니다.';
  end if;

  update public.investment_shop_items
  set quantity = quantity - 1
  where client_id = p_client_id
    and item_type = 'megaphone';
  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'megaphone'
    and quantity <= 0;

  insert into public.investment_shop_messages(
    client_id, sender_name, message_body, message
  )
  select client_id, v_nickname, v_message, v_nickname || ': ' || v_message
  from public.investment_users;
  get diagnostics v_user_count = row_count;

  return jsonb_build_object(
    'user_count', v_user_count,
    'message', v_message
  );
end;
$$;

create or replace function public.shop_use_gambling_box(
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity bigint;
  v_factor numeric;
  v_percent integer;
  v_new_cash bigint;
begin
  select quantity
  into v_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'gambling_box'
  for update;

  if coalesce(v_quantity, 0) < 1 then
    raise exception '가방에 도박 중독자 상자가 없습니다.';
  end if;

  update public.investment_shop_items
  set quantity = quantity - 1
  where client_id = p_client_id
    and item_type = 'gambling_box';

  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = 'gambling_box'
    and quantity <= 0;

  if random() < 0.5 then
    v_percent := -50;
  else
    v_percent := 100;
  end if;

  v_factor := 1 + v_percent / 100.0;

  update public.investment_users
  set cash = greatest(0, round(cash * v_factor))
  where client_id = p_client_id
  returning cash into v_new_cash;

  if v_new_cash is null then
    raise exception '투자 유저 정보를 찾을 수 없습니다.';
  end if;

  update public.investment_holdings
  set quantity = greatest(0, floor(quantity * v_factor)),
      invested_amount = greatest(0, round(invested_amount * v_factor))
  where client_id = p_client_id;

  delete from public.investment_holdings
  where client_id = p_client_id
    and quantity <= 0;

  return jsonb_build_object(
    'percent', v_percent,
    'message',
      '도박 중독자 상자를 개봉해 전체 자산이 '
      || case when v_percent >= 0 then '+' else '' end
      || v_percent || '% 변했습니다.'
  );
end;
$$;

create or replace function public.shop_purchase_coin_box(
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
  if p_quantity is null or p_quantity < 1 then
    raise exception '구매 수량은 1개 이상이어야 합니다.';
  end if;

  select coins
    into v_coins
  from public.sanggi_game_states
  where account_id = p_client_id
  for update;
  if v_coins is null then
    raise exception '상기 키우기 정보를 먼저 동기화하세요.';
  end if;
  select quantity
    into v_owned_quantity
  from public.investment_shop_items
  where client_id = p_client_id and item_type = p_item_type
  for update;
  if coalesce(v_owned_quantity, 0) + p_quantity > 100 then
    raise exception '상자는 한 종류당 최대 100개까지 보유할 수 있습니다.';
  end if;
  if v_coins < v_price * p_quantity then
    raise exception '보유 코인이 부족합니다.';
  end if;

  update public.sanggi_game_states
  set coins = coins - v_price * p_quantity,
      updated_at = now()
  where account_id = p_client_id
  returning coins into v_coins;

  insert into public.investment_shop_items(client_id, item_type, quantity)
  values (p_client_id, p_item_type, p_quantity)
  on conflict (client_id, item_type)
  do update set quantity = public.investment_shop_items.quantity + excluded.quantity;

  return jsonb_build_object(
    'message', v_name || ' ' || p_quantity || '개를 구매했습니다.',
    'coins', v_coins::text,
    'quantity', coalesce(v_owned_quantity, 0) + p_quantity
  );
end;
$$;

drop function if exists public.shop_use_cash_box(uuid, text, uuid);

create or replace function public.shop_use_cash_box(
  p_client_id uuid,
  p_item_type text,
  p_target_client_id uuid default null,
  p_quantity bigint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity bigint;
  v_target_id uuid := coalesce(p_target_client_id, p_client_id);
  v_target_name text;
  v_sender_name text;
  v_amount bigint;
  v_factor numeric;
  v_percent integer;
  v_new_cash bigint;
  v_transfer_quantity bigint;
begin
  if p_item_type not in ('cash_box', 'weird_cash_box') then
    raise exception '사용할 수 없는 현금 박스입니다.';
  end if;
  select quantity into v_quantity
  from public.investment_shop_items
  where client_id = p_client_id and item_type = p_item_type
  for update;
  v_transfer_quantity := case
    when p_target_client_id is null or p_target_client_id = p_client_id then 1
    else coalesce(p_quantity, 0)
  end;
  if v_transfer_quantity < 1 then
    raise exception '선물할 수량은 1개 이상이어야 합니다.';
  end if;
  if coalesce(v_quantity, 0) < v_transfer_quantity then
    raise exception '가방에 해당 현금 박스가 없습니다.';
  end if;
  if p_target_client_id is not null
    and p_target_client_id <> p_client_id
    and exists (
      select 1
      from public.investment_shop_items
      where client_id = p_target_client_id
        and item_type = p_item_type
        and quantity + v_transfer_quantity > 100
    ) then
    raise exception '선물받는 유저의 상자 보유 한도에 도달했습니다.';
  end if;
  select nickname into v_sender_name
  from public.investment_users
  where client_id = p_client_id;
  select nickname into v_target_name
  from public.investment_users
  where client_id = v_target_id
  for update;
  if v_target_name is null then
    raise exception '선물할 유저를 찾을 수 없습니다.';
  end if;

  update public.investment_shop_items
  set quantity = quantity - v_transfer_quantity
  where client_id = p_client_id and item_type = p_item_type;
  delete from public.investment_shop_items
  where client_id = p_client_id and item_type = p_item_type and quantity <= 0;

  if p_target_client_id is not null and p_target_client_id <> p_client_id then
    insert into public.investment_shop_items(client_id, item_type, quantity)
    values (p_target_client_id, p_item_type, v_transfer_quantity)
    on conflict (client_id, item_type)
    do update set quantity = public.investment_shop_items.quantity + excluded.quantity;
    if v_sender_name is not null then
      insert into public.investment_shop_messages(
        client_id, sender_name, message_body, message
      )
      values (p_target_client_id, v_sender_name,
        case p_item_type
        when 'cash_box' then '랜덤 현금 박스'
        else '이상한 랜덤 현금 박스'
      end || '를 선물했습니다.',
        v_sender_name || '님이 ' || case p_item_type
        when 'cash_box' then '랜덤 현금 박스'
        else '이상한 랜덤 현금 박스'
      end || '를 선물했습니다.');
    end if;
    return jsonb_build_object(
      'message', v_target_name || '님에게 상자 ' || v_transfer_quantity || '개를 선물했습니다.'
    );
  end if;

  if p_item_type = 'cash_box' then
    v_amount := floor(random() * 1000000001)::bigint + 1000000;
    update public.investment_users
    set cash = cash + v_amount
    where client_id = p_client_id;
    return jsonb_build_object(
      'message', '랜덤 현금 박스를 개봉해 ' ||
        to_char(v_amount, 'FM999,999,999,999,999,999') || '원을 받았습니다.',
      'amount', v_amount
    );
  end if;

  v_percent := floor(random() * 61)::integer - 30;
  v_factor := 1 + v_percent / 100.0;
  update public.investment_users
  set cash = greatest(0, round(cash * v_factor))
  where client_id = p_client_id
  returning cash into v_new_cash;
  update public.investment_holdings
  set quantity = greatest(0, floor(quantity * v_factor)),
      invested_amount = greatest(0, round(invested_amount * v_factor))
  where client_id = p_client_id;
  delete from public.investment_holdings
  where client_id = p_client_id and quantity <= 0;
  return jsonb_build_object(
    'message', '이상한 랜덤 현금 박스를 개봉해 자산이 ' ||
      case when v_percent >= 0 then '+' else '' end || v_percent || '% 변했습니다.',
    'percent', v_percent
  );
end;
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

  insert into public.investment_shop_messages(
    client_id, sender_name, message_body, message
  )
  values (
    p_target_client_id,
    v_sender_name,
    v_message,
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
  v_shield_quantity bigint;
  v_shield_required bigint;
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
      when 'nuclear_missile' then 0.80
    end,
    case p_item_type
      when 'low_missile' then 0.20
      when 'mid_missile' then 0.30
      when 'high_missile' then 0.40
      when 'nuclear_missile' then 0.80
    end,
    case p_item_type
      when 'low_missile' then '하급 미사일'
      when 'mid_missile' then '중급 미사일'
      when 'high_missile' then '고급 미사일'
      else '핵 미사일'
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

  v_shield_required := case p_item_type
    when 'low_missile' then 1
    when 'mid_missile' then 3
    when 'high_missile' then 5
    when 'nuclear_missile' then 10
  end;
  select quantity into v_shield_quantity
  from public.investment_shop_items
  where client_id = p_target_client_id
    and item_type = 'missile_shield'
  for update;

  if coalesce(v_shield_quantity, 0) >= v_shield_required then
    update public.investment_shop_items
    set quantity = quantity - v_shield_required
    where client_id = p_target_client_id
      and item_type = 'missile_shield';

    delete from public.investment_shop_items
    where client_id = p_target_client_id
      and item_type = 'missile_shield'
      and quantity <= 0;

    insert into public.investment_shop_messages(client_id, message)
    values (
      p_target_client_id,
      v_name || ' 공격을 미사일 방어막 '
        || v_shield_required || '개로 막았습니다. 피해를 받지 않았습니다.'
    ), (
      p_client_id,
      v_name || ' 발사 성공! ' || v_target_name || '에게 명중했지만 '
        || '미사일 방어막 ' || v_shield_required || '개에 의해 막혔습니다.'
    );

    return jsonb_build_object(
      'success', true,
      'blocked', true,
      'message', v_name || ' 명중! ' || v_target_name
        || '에게 공격이 성공했습니다.',
      'blocked_message', v_name || ' 공격이 '
        || v_target_name || '의 미사일 방어막에 의해 막혔습니다.'
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

create or replace function public.shop_discard_item(
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
  v_owned_quantity bigint;
  v_name text;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception '버릴 수량은 1개 이상이어야 합니다.';
  end if;

  v_name := case p_item_type
    when 'low_missile' then '하급 미사일'
    when 'mid_missile' then '중급 미사일'
    when 'high_missile' then '고급 미사일'
    when 'nuclear_missile' then '핵 미사일'
    when 'missile_shield' then '미사일 방어막'
    when 'nickname_ticket' then '닉네임 변경권'
    when 'letter' then '편지'
    when 'megaphone' then '확성기'
    when 'normal_potion' then '일반 물약'
    when 'advanced_potion' then '고급 물약'
    when 'legendary_potion' then '전설 물약'
    when 'sanggi_hanbok' then '상기 한복'
    when 'sanggi_spacesuit' then '상기 우주복'
    when 'juseong_hanbok' then '주성 한복'
    when 'juseong_spacesuit' then '주성 우주복'
    when 'cash_box' then '랜덤 현금 박스'
    when 'weird_cash_box' then '이상한 랜덤 현금 박스'
    else null
  end;

  if v_name is null then
    raise exception '버릴 수 없는 아이템입니다.';
  end if;

  if p_item_type in (
    'sanggi_hanbok', 'sanggi_spacesuit',
    'juseong_hanbok', 'juseong_spacesuit'
  ) then
    raise exception '의상 아이템은 버릴 수 없습니다.';
  end if;

  select quantity
  into v_owned_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
  for update;

  if coalesce(v_owned_quantity, 0) < p_quantity then
    raise exception '보유 수량보다 많이 버릴 수 없습니다.';
  end if;

  update public.investment_shop_items
  set quantity = quantity - p_quantity
  where client_id = p_client_id
    and item_type = p_item_type;

  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
    and quantity <= 0;

  return jsonb_build_object(
    'message',
    v_name || ' ' || p_quantity || '개를 버렸습니다.'
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
revoke all on function public.shop_purchase_coin_box(uuid, text, bigint) from public;
revoke all on function public.shop_use_cash_box(uuid, text, uuid, bigint) from public;
revoke all on function public.shop_use_missile(uuid, text, uuid) from public;
revoke all on function public.shop_discard_item(uuid, text, bigint) from public;
revoke all on function public.shop_send_letter(uuid, uuid, text) from public;
revoke all on function public.shop_change_nickname(uuid, uuid, text) from public;
revoke all on function public.shop_use_megaphone(uuid, text) from public;
revoke all on function public.shop_use_gambling_box(uuid) from public;
revoke all on function public.investment_link_account(uuid, uuid) from public;
grant execute on function public.shop_get_state(uuid) to anon, authenticated;
grant execute on function public.shop_get_state(uuid, text) to anon, authenticated;
grant execute on function public.shop_get_unread_count(uuid) to anon, authenticated;
grant execute on function public.shop_get_messages(uuid) to anon, authenticated;
grant execute on function public.shop_purchase(uuid, text, bigint) to anon, authenticated;
grant execute on function public.shop_purchase(uuid, text) to anon, authenticated;
grant execute on function public.shop_purchase_coin_box(uuid, text, bigint) to anon, authenticated;
grant execute on function public.shop_use_cash_box(uuid, text, uuid, bigint) to anon, authenticated;
grant execute on function public.shop_use_megaphone(uuid, text) to anon, authenticated;
grant execute on function public.shop_use_gambling_box(uuid) to anon, authenticated;
grant execute on function public.shop_use_megaphone(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- 기록(?) 게시판
create table if not exists public.record_posts (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(trim(nickname)) between 1 and 24),
  password_hash text not null check (password_hash ~ '^[0-9a-f]{64}$'),
  title text not null check (char_length(trim(title)) between 1 and 100),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  upvotes bigint not null default 0 check (upvotes >= 0),
  downvotes bigint not null default 0 check (downvotes >= 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.record_posts(id) on delete cascade,
  parent_id uuid references public.record_comments(id) on delete cascade,
  nickname text not null check (char_length(trim(nickname)) between 1 and 24),
  password_hash text not null check (password_hash ~ '^[0-9a-f]{64}$'),
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table if not exists public.record_votes (
  post_id uuid not null references public.record_posts(id) on delete cascade,
  voter_key text not null check (char_length(voter_key) between 16 and 128),
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, voter_key)
);

create table if not exists public.record_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 100),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table if not exists public.record_polls (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null unique references public.record_posts(id) on delete cascade,
 question text not null check (char_length(trim(question)) between 1 and 150),
 created_at timestamptz not null default now()
);

create table if not exists public.record_poll_options (
 id uuid primary key default gen_random_uuid(),
 poll_id uuid not null references public.record_polls(id) on delete cascade,
 option_text text not null check (char_length(trim(option_text)) between 1 and 80),
 vote_count bigint not null default 0 check (vote_count >= 0),
 option_order integer not null default 0
);

create table if not exists public.record_poll_votes (
 poll_id uuid not null references public.record_polls(id) on delete cascade,
 option_id uuid not null references public.record_poll_options(id) on delete cascade,
 voter_key text not null check (char_length(voter_key) between 16 and 128),
 created_at timestamptz not null default now(),
 primary key (poll_id, voter_key)
);

alter table public.record_posts add column if not exists view_count bigint not null default 0;

create or replace function public.record_increment_view(p_post_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.record_posts
  set view_count = view_count + 1
  where id = p_post_id
  returning view_count;
$$;

revoke all on function public.record_increment_view(uuid) from public;
grant execute on function public.record_increment_view(uuid) to anon, authenticated;

alter table public.record_posts enable row level security;
alter table public.record_comments enable row level security;
alter table public.record_votes enable row level security;
alter table public.record_notices enable row level security;
alter table public.record_polls enable row level security;
alter table public.record_poll_options enable row level security;
alter table public.record_poll_votes enable row level security;
revoke all on table public.record_posts, public.record_comments,
  public.record_votes, public.record_notices, public.record_polls,
  public.record_poll_options, public.record_poll_votes from anon, authenticated;

create or replace function public.record_get_board()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'posts', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at desc)
      from (
        select rp.id, rp.nickname, rp.title, rp.body, rp.upvotes, rp.downvotes,
               rp.created_at, rp.edited_at, rp.view_count,
               (select count(*) from public.record_comments rc where rc.post_id = rp.id) as comment_count,
               (
                 select jsonb_build_object(
                   'id', poll.id,
                   'question', poll.question,
                   'options', coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'id', option.id,
                       'text', option.option_text,
                       'votes', option.vote_count
                     ) order by option.option_order, option.id)
                     from public.record_poll_options option
                     where option.poll_id = poll.id
                   ), '[]'::jsonb)
                 )
                 from public.record_polls poll
                 where poll.post_id = rp.id
               ) as poll
        from public.record_posts rp
      ) p
    ), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(to_jsonb(rn) order by rn.created_at desc)
      from public.record_notices rn
    ), '[]'::jsonb)
  );
$$;

create or replace function public.record_get_comments(p_post_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at asc), '[]'::jsonb)
  from (
    select id, post_id, parent_id, nickname, body, created_at, edited_at
    from public.record_comments
    where post_id = p_post_id
  ) c;
$$;

create or replace function public.record_create_post(
  p_nickname text,
  p_password_hash text,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_password_hash !~ '^[0-9a-f]{64}$' then raise exception '비밀번호 형식이 올바르지 않습니다.'; end if;
  insert into public.record_posts(nickname, password_hash, title, body)
  values (trim(p_nickname), p_password_hash, trim(p_title), trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_create_post(
  p_nickname text,
  p_password_hash text,
  p_title text,
  p_body text,
  p_poll_question text,
  p_poll_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_poll_id uuid;
  v_option jsonb;
  v_index integer := 0;
begin
  if p_password_hash !~ '^[0-9a-f]{64}$' then
    raise exception '비밀번호 형식이 올바르지 않습니다.';
  end if;
  if nullif(trim(p_poll_question), '') is not null
     and (jsonb_typeof(p_poll_options) <> 'array'
       or jsonb_array_length(p_poll_options) < 2
       or jsonb_array_length(p_poll_options) > 6) then
    raise exception '투표 선택지는 2개에서 6개까지 입력해야 합니다.';
  end if;
  insert into public.record_posts(nickname, password_hash, title, body)
  values (trim(p_nickname), p_password_hash, trim(p_title), trim(p_body))
  returning id into v_id;
  if nullif(trim(p_poll_question), '') is not null then
    insert into public.record_polls(post_id, question)
    values (v_id, trim(p_poll_question))
    returning id into v_poll_id;
    for v_option in select value from jsonb_array_elements(p_poll_options) loop
      if char_length(trim(v_option #>> '{}')) = 0 then
        raise exception '투표 선택지는 비워둘 수 없습니다.';
      end if;
      insert into public.record_poll_options(poll_id, option_text, option_order)
      values (v_poll_id, trim(v_option #>> '{}'), v_index);
      v_index := v_index + 1;
    end loop;
  end if;
  return v_id;
end;
$$;

create or replace function public.record_update_post(
  p_id uuid,
  p_password_hash text,
  p_title text,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.record_posts
  set title = trim(p_title), body = trim(p_body), edited_at = now()
  where id = p_id and password_hash = p_password_hash;
  if not found then raise exception '게시물 비밀번호가 올바르지 않습니다.'; end if;
  return true;
end;
$$;

create or replace function public.record_delete_post(
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
  delete from public.record_posts
  where id = p_id
    and (password_hash = p_password_hash or p_admin_password = '8170');
  if not found then raise exception '게시물 비밀번호 또는 관리자 비밀번호가 올바르지 않습니다.'; end if;
  return true;
end;
$$;

create or replace function public.record_vote_post(
  p_post_id uuid,
  p_voter_key text,
  p_vote smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_upvotes bigint; v_downvotes bigint;
begin
  if p_vote not in (-1, 1) then raise exception '올바르지 않은 추천 값입니다.'; end if;
  insert into public.record_votes(post_id, voter_key, vote)
  values (p_post_id, p_voter_key, p_vote)
  on conflict (post_id, voter_key) do update set vote = excluded.vote;
  select count(*) filter (where vote = 1), count(*) filter (where vote = -1)
  into v_upvotes, v_downvotes
  from public.record_votes where post_id = p_post_id;
  update public.record_posts set upvotes = v_upvotes, downvotes = v_downvotes where id = p_post_id;
  return jsonb_build_object('upvotes', v_upvotes, 'downvotes', v_downvotes);
end;
$$;

create or replace function public.record_vote_poll(
  p_poll_id uuid,
  p_option_id uuid,
  p_voter_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_option uuid;
begin
  if not exists (
    select 1 from public.record_poll_options
    where id = p_option_id and poll_id = p_poll_id
  ) then
    raise exception '올바르지 않은 투표 선택지입니다.';
  end if;
  select option_id into v_previous_option
  from public.record_poll_votes
  where poll_id = p_poll_id and voter_key = p_voter_key;
  if v_previous_option is not null and v_previous_option <> p_option_id then
    update public.record_poll_options set vote_count = greatest(vote_count - 1, 0)
    where id = v_previous_option;
  end if;
  insert into public.record_poll_votes(poll_id, option_id, voter_key)
  values (p_poll_id, p_option_id, p_voter_key)
  on conflict (poll_id, voter_key) do update set option_id = excluded.option_id;
  update public.record_poll_options set vote_count = vote_count + 1
  where id = p_option_id and (v_previous_option is null or v_previous_option <> p_option_id);
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.record_create_comment(
  p_post_id uuid,
  p_parent_id uuid,
  p_nickname text,
  p_password_hash text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.record_posts where id = p_post_id) then raise exception '게시물을 찾을 수 없습니다.'; end if;
  if p_parent_id is not null and not exists (
    select 1 from public.record_comments where id = p_parent_id and post_id = p_post_id
  ) then raise exception '답글 대상을 찾을 수 없습니다.'; end if;
  insert into public.record_comments(post_id, parent_id, nickname, password_hash, body)
  values (p_post_id, p_parent_id, trim(p_nickname), p_password_hash, trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_update_comment(
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
  update public.record_comments
  set body = trim(p_body), edited_at = now()
  where id = p_id and password_hash = p_password_hash;
  if not found then raise exception '댓글 비밀번호가 올바르지 않습니다.'; end if;
  return true;
end;
$$;

create or replace function public.record_delete_comment(
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
  delete from public.record_comments
  where id = p_id
    and (password_hash = p_password_hash or p_admin_password = '8170');
  if not found then raise exception '댓글 비밀번호 또는 관리자 비밀번호가 올바르지 않습니다.'; end if;
  return true;
end;
$$;

create or replace function public.record_create_notice(
  p_admin_password text,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_admin_password <> '8170' then raise exception '관리자 비밀번호가 올바르지 않습니다.'; end if;
  insert into public.record_notices(title, body)
  values (trim(p_title), trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_update_notice(
  p_id uuid,
  p_admin_password text,
  p_title text,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then raise exception '관리자 비밀번호가 올바르지 않습니다.'; end if;
  update public.record_notices
  set title = trim(p_title), body = trim(p_body), edited_at = now()
  where id = p_id;
  if not found then raise exception '공지를 찾을 수 없습니다.'; end if;
  return true;
end;
$$;

create or replace function public.record_delete_notice(
  p_id uuid,
  p_admin_password text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then raise exception '관리자 비밀번호가 올바르지 않습니다.'; end if;
  delete from public.record_notices where id = p_id;
  if not found then raise exception '공지를 찾을 수 없습니다.'; end if;
  return true;
end;
$$;

revoke all on function public.record_get_board() from public;
revoke all on function public.record_get_comments(uuid) from public;
revoke all on function public.record_create_post(text, text, text, text) from public;
revoke all on function public.record_create_post(text, text, text, text, text, jsonb) from public;
revoke all on function public.record_update_post(uuid, text, text, text) from public;
revoke all on function public.record_delete_post(uuid, text, text) from public;
revoke all on function public.record_vote_post(uuid, text, smallint) from public;
revoke all on function public.record_vote_poll(uuid, uuid, text) from public;
revoke all on function public.record_create_comment(uuid, uuid, text, text, text) from public;
revoke all on function public.record_update_comment(uuid, text, text) from public;
revoke all on function public.record_delete_comment(uuid, text, text) from public;
revoke all on function public.record_create_notice(text, text, text) from public;
revoke all on function public.record_update_notice(uuid, text, text, text) from public;
revoke all on function public.record_delete_notice(uuid, text) from public;
grant execute on function public.record_get_board() to anon, authenticated;
grant execute on function public.record_get_comments(uuid) to anon, authenticated;
grant execute on function public.record_create_post(text, text, text, text) to anon, authenticated;
grant execute on function public.record_create_post(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.record_update_post(uuid, text, text, text) to anon, authenticated;
grant execute on function public.record_delete_post(uuid, text, text) to anon, authenticated;
grant execute on function public.record_vote_post(uuid, text, smallint) to anon, authenticated;
grant execute on function public.record_vote_poll(uuid, uuid, text) to anon, authenticated;
grant execute on function public.record_create_comment(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.record_update_comment(uuid, text, text) to anon, authenticated;
grant execute on function public.record_delete_comment(uuid, text, text) to anon, authenticated;
grant execute on function public.record_create_notice(text, text, text) to anon, authenticated;
grant execute on function public.record_update_notice(uuid, text, text, text) to anon, authenticated;
grant execute on function public.record_delete_notice(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- 한국 시간(Asia/Seoul) 매일 00:00에 일일 상점 보상을 지급합니다.
create extension if not exists pg_cron with schema extensions;

do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'investment-daily-shop-rewards';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'investment-daily-shop-rewards',
    '0 15 * * *',
    $job$select public.investment_daily_shop_reward_tick((now() at time zone 'Asia/Seoul')::date);$job$
  );
end;
$$;

-- Account-scoped site preferences and comment state.
create table if not exists public.site_account_state (
  account_id uuid primary key references public.site_accounts(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_account_state enable row level security;
revoke all on table public.site_account_state from anon, authenticated;

create or replace function public.site_get_account_state(
  p_session_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_state jsonb;
begin
  select account_id into v_account_id
  from public.site_account_sessions
  where token = p_session_token and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  select state into v_state
  from public.site_account_state
  where account_id = v_account_id;

  return coalesce(v_state, '{}'::jsonb);
end;
$$;

create or replace function public.site_save_account_state(
  p_session_token uuid,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_state jsonb;
begin
  select account_id into v_account_id
  from public.site_account_sessions
  where token = p_session_token and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  v_state := case
    when jsonb_typeof(coalesce(p_state, '{}'::jsonb)) = 'object'
      then coalesce(p_state, '{}'::jsonb)
    else '{}'::jsonb
  end;

  insert into public.site_account_state(account_id, state, updated_at)
  values (v_account_id, v_state, now())
  on conflict (account_id) do update set
    state = excluded.state,
    updated_at = now();

  return v_state;
end;
$$;

revoke all on function public.site_get_account_state(uuid) from public;
revoke all on function public.site_save_account_state(uuid, jsonb) from public;
grant execute on function public.site_get_account_state(uuid) to anon, authenticated;
grant execute on function public.site_save_account_state(uuid, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

-- Sanggi game account state.
create table if not exists public.sanggi_game_states (
  account_id uuid primary key references public.site_accounts(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  player_level integer not null default 1 check (player_level >= 1),
  breath_level integer not null default 1 check (breath_level between 1 and 3000),
  auto_level integer not null default 1 check (auto_level between 1 and 50),
  character_x numeric not null default 0.09 check (character_x between 0 and 1),
  character_y numeric not null default 0.07 check (character_y between 0 and 1),
  companion_unlocked boolean not null default false,
  companion_summoned boolean not null default false,
  companion_level integer not null default 1 check (companion_level between 1 and 3000),
  companion_x numeric not null default 0.58 check (companion_x between 0 and 1),
  companion_y numeric not null default 0.1 check (companion_y between 0 and 1),
  normal_potions integer not null default 0 check (normal_potions >= 0 and normal_potions <= 100),
  advanced_potions integer not null default 0 check (advanced_potions >= 0 and advanced_potions <= 100),
  legendary_potions integer not null default 0 check (legendary_potions >= 0 and legendary_potions <= 100),
  updated_at timestamptz not null default now()
);

alter table public.sanggi_game_states enable row level security;
revoke all on table public.sanggi_game_states from anon, authenticated;
alter table public.sanggi_game_states
  add column if not exists companion_unlocked boolean not null default false,
  add column if not exists companion_summoned boolean not null default false,
  add column if not exists companion_level integer not null default 1,
  add column if not exists companion_x numeric not null default 0.58,
  add column if not exists companion_y numeric not null default 0.1,
  add column if not exists player_level integer not null default 1,
  add column if not exists normal_potions integer not null default 0,
  add column if not exists advanced_potions integer not null default 0,
  add column if not exists legendary_potions integer not null default 0,
  add column if not exists sanggi_outfit text not null default 'default',
  add column if not exists companion_outfit text not null default 'default';
alter table public.sanggi_game_states
  drop constraint if exists sanggi_game_states_player_level_check;
alter table public.sanggi_game_states
  add constraint sanggi_game_states_player_level_check check (player_level >= 1);
alter table public.sanggi_game_states
  drop constraint if exists sanggi_game_states_companion_x_check,
  drop constraint if exists sanggi_game_states_companion_y_check;
alter table public.sanggi_game_states
  add constraint sanggi_game_states_companion_x_check check (companion_x between 0 and 1),
  add constraint sanggi_game_states_companion_y_check check (companion_y between 0 and 1);
alter table public.sanggi_game_states
  drop constraint if exists sanggi_game_states_companion_level_check;
alter table public.sanggi_game_states
  add constraint sanggi_game_states_companion_level_check check (companion_level between 1 and 3000);
alter table public.sanggi_game_states
  drop constraint if exists sanggi_game_states_normal_potions_check,
  drop constraint if exists sanggi_game_states_advanced_potions_check;
alter table public.sanggi_game_states
  add constraint sanggi_game_states_normal_potions_check check (normal_potions between 0 and 100),
  add constraint sanggi_game_states_advanced_potions_check check (advanced_potions between 0 and 100),
  add constraint sanggi_game_states_legendary_potions_check check (legendary_potions between 0 and 100);

drop function if exists public.sanggi_sync_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, numeric, numeric, numeric);
drop function if exists public.sanggi_sync_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric);
drop function if exists public.sanggi_sync_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer, integer);
drop function if exists public.sanggi_sync_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer, integer, integer);
create or replace function public.sanggi_sync_state(
  p_session_token uuid,
  p_guest_coins bigint default 0,
  p_guest_breath_level integer default 1,
  p_guest_auto_level integer default 1,
  p_guest_character_x numeric default 0.09,
  p_guest_character_y numeric default 0.07,
  p_guest_companion_unlocked boolean default false,
  p_guest_companion_summoned boolean default false,
  p_guest_companion_level integer default 1,
  p_guest_companion_x numeric default 0.58,
  p_guest_companion_y numeric default 0.1,
  p_guest_player_level integer default 1,
  p_guest_normal_potions integer default 0,
  p_guest_advanced_potions integer default 0,
  p_guest_legendary_potions integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_state public.sanggi_game_states%rowtype;
begin
  select account_id
  into v_account_id
  from public.site_account_sessions
  where token = p_session_token
    and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  select *
  into v_state
  from public.sanggi_game_states
  where account_id = v_account_id
  for update;

  if v_state.account_id is null then
    insert into public.sanggi_game_states (
      account_id, coins, breath_level, auto_level, character_x, character_y,
      companion_unlocked, companion_summoned, companion_level, companion_x, companion_y,
      player_level, normal_potions, advanced_potions, legendary_potions
    )
    values (
      v_account_id,
      greatest(0, coalesce(p_guest_coins, 0)),
      greatest(1, least(3000, coalesce(p_guest_breath_level, 1))),
      greatest(1, least(50, coalesce(p_guest_auto_level, 1))),
      greatest(0, least(1, coalesce(p_guest_character_x, 0.09))),
      greatest(0, least(1, coalesce(p_guest_character_y, 0.07))),
      coalesce(p_guest_companion_unlocked, false),
      coalesce(p_guest_companion_summoned, false) and coalesce(p_guest_companion_unlocked, false),
      greatest(1, least(3000, coalesce(p_guest_companion_level, 1))),
      greatest(0, least(1, coalesce(p_guest_companion_x, 0.58))),
      greatest(0, least(1, coalesce(p_guest_companion_y, 0.1))),
      greatest(1, coalesce(p_guest_player_level, 1)),
      greatest(0, least(100, coalesce(p_guest_normal_potions, 0))),
      greatest(0, least(100, coalesce(p_guest_advanced_potions, 0))),
      greatest(0, least(100, coalesce(p_guest_legendary_potions, 0)))
    )
    returning * into v_state;
  end if;

  return jsonb_build_object(
    'coins', v_state.coins::text,
    'breath_level', v_state.breath_level,
    'auto_level', v_state.auto_level,
    'character_x', v_state.character_x,
    'character_y', v_state.character_y,
    'companion_unlocked', v_state.companion_unlocked,
    'companion_summoned', v_state.companion_summoned,
    'companion_level', v_state.companion_level,
    'companion_x', v_state.companion_x,
    'companion_y', v_state.companion_y,
    'player_level', v_state.player_level,
    'normal_potions', v_state.normal_potions,
    'advanced_potions', v_state.advanced_potions,
    'legendary_potions', v_state.legendary_potions
  );
end;
$$;

create or replace function public.sanggi_get_outfits(
  p_session_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_sanggi_outfit text;
  v_companion_outfit text;
begin
  select account_id
    into v_account_id
  from public.site_account_sessions
  where token = p_session_token
    and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  select sanggi_outfit, companion_outfit
    into v_sanggi_outfit, v_companion_outfit
  from public.sanggi_game_states
  where account_id = v_account_id;

  return jsonb_build_object(
    'sanggi_outfit', coalesce(v_sanggi_outfit, 'default'),
    'companion_outfit', coalesce(v_companion_outfit, 'default')
  );
end;
$$;

create or replace function public.sanggi_set_outfits(
  p_session_token uuid,
  p_sanggi_outfit text default 'default',
  p_companion_outfit text default 'default'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id
    into v_account_id
  from public.site_account_sessions
  where token = p_session_token
    and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  if p_sanggi_outfit not in ('default', 'sanggi_hanbok', 'sanggi_spacesuit')
    or p_companion_outfit not in ('default', 'juseong_hanbok', 'juseong_spacesuit') then
    raise exception '존재하지 않는 의상입니다.';
  end if;

  if p_sanggi_outfit <> 'default'
    and not exists (
      select 1
      from public.investment_shop_items
      where client_id = v_account_id
        and item_type = p_sanggi_outfit
        and quantity > 0
    ) then
    raise exception '구매한 상기 의상만 착용할 수 있습니다.';
  end if;

  if p_companion_outfit <> 'default'
    and not exists (
      select 1
      from public.investment_shop_items
      where client_id = v_account_id
        and item_type = p_companion_outfit
        and quantity > 0
    ) then
    raise exception '구매한 주성 의상만 착용할 수 있습니다.';
  end if;

  update public.sanggi_game_states
  set sanggi_outfit = p_sanggi_outfit,
      companion_outfit = p_companion_outfit,
      updated_at = now()
  where account_id = v_account_id;

  return jsonb_build_object(
    'sanggi_outfit', p_sanggi_outfit,
    'companion_outfit', p_companion_outfit
  );
end;
$$;

create or replace function public.sanggi_use_potion(
  p_session_token uuid,
  p_potion_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_state public.sanggi_game_states%rowtype;
begin
  select account_id into v_account_id
  from public.site_account_sessions
  where token = p_session_token and expires_at > now();
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;
  select * into v_state
  from public.sanggi_game_states
  where account_id = v_account_id
  for update;
  if v_state.account_id is null then
    raise exception '상기 키우기 정보를 먼저 동기화하세요.';
  end if;
  if p_potion_type = 'normal' then
    if v_state.normal_potions < 1 then raise exception '일반 물약이 없습니다.'; end if;
    update public.sanggi_game_states set normal_potions = normal_potions - 1, updated_at = now()
    where account_id = v_account_id returning * into v_state;
  elsif p_potion_type = 'advanced' then
    if v_state.advanced_potions < 1 then raise exception '고급 물약이 없습니다.'; end if;
    update public.sanggi_game_states set advanced_potions = advanced_potions - 1, updated_at = now()
    where account_id = v_account_id returning * into v_state;
  elsif p_potion_type = 'legendary' then
    if v_state.legendary_potions < 1 then raise exception '전설 물약이 없습니다.'; end if;
    update public.sanggi_game_states set legendary_potions = legendary_potions - 1, updated_at = now()
    where account_id = v_account_id returning * into v_state;
  else
    raise exception '존재하지 않는 물약입니다.';
  end if;
  return jsonb_build_object(
    'normal_potions', v_state.normal_potions,
    'advanced_potions', v_state.advanced_potions,
    'legendary_potions', v_state.legendary_potions
  );
end;
$$;

create or replace function public.sanggi_upgrade_player(p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_state public.sanggi_game_states%rowtype;
  v_cost bigint;
begin
  select account_id
  into v_account_id
  from public.site_account_sessions
  where token = p_session_token
    and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  select *
  into v_state
  from public.sanggi_game_states
  where account_id = v_account_id
  for update;

  if v_state.account_id is null then
    raise exception '상기 키우기 정보를 먼저 동기화하세요.';
  end if;

  v_cost := 10000 * v_state.player_level::bigint;
  if v_state.coins < v_cost then
    raise exception '코인이 부족합니다. 필요한 비용은 %원입니다.', to_char(v_cost, 'FM999,999,999,999,999,999');
  end if;

  update public.sanggi_game_states
  set coins = coins - v_cost,
      player_level = player_level + 1,
      updated_at = now()
  where account_id = v_account_id
  returning * into v_state;

  return jsonb_build_object(
    'coins', v_state.coins::text,
    'player_level', v_state.player_level
  );
end;
$$;

create or replace function public.sanggi_get_player_ranking(p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_ranking jsonb;
begin
  select account_id
  into v_account_id
  from public.site_account_sessions
  where token = p_session_token
    and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'nickname', u.nickname,
      'player_level', s.player_level
    )
    order by s.player_level desc, u.nickname asc
  ), '[]'::jsonb)
  into v_ranking
  from public.sanggi_game_states s
  join public.investment_users u
    on u.client_id = s.account_id
  where u.nickname is not null
    and char_length(trim(u.nickname)) > 0;

  return v_ranking;
end;
$$;

drop function if exists public.sanggi_save_state(uuid, bigint, integer, integer, numeric, numeric, numeric, numeric, numeric);
drop function if exists public.sanggi_save_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric);
drop function if exists public.sanggi_save_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer);
drop function if exists public.sanggi_save_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer, integer);
create or replace function public.sanggi_save_state(
  p_session_token uuid,
  p_coins bigint,
  p_breath_level integer,
  p_auto_level integer,
  p_character_x numeric,
  p_character_y numeric,
  p_companion_unlocked boolean,
  p_companion_summoned boolean,
  p_companion_level integer,
  p_companion_x numeric,
  p_companion_y numeric,
  p_normal_potions integer default 0,
  p_advanced_potions integer default 0,
  p_legendary_potions integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id
  into v_account_id
  from public.site_account_sessions
  where token = p_session_token
    and expires_at > now();

  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  insert into public.sanggi_game_states (
    account_id, coins, breath_level, auto_level, character_x, character_y,
    companion_unlocked, companion_summoned, companion_level, companion_x, companion_y,
    normal_potions, advanced_potions, legendary_potions, updated_at
  )
  values (
    v_account_id,
    greatest(0, p_coins),
    greatest(1, least(3000, p_breath_level)),
    greatest(1, least(50, p_auto_level)),
    greatest(0, least(1, p_character_x)),
    greatest(0, least(1, p_character_y)),
    coalesce(p_companion_unlocked, false),
    coalesce(p_companion_summoned, false) and coalesce(p_companion_unlocked, false),
    greatest(1, least(3000, coalesce(p_companion_level, 1))),
    greatest(0, least(1, p_companion_x)),
    greatest(0, least(1, p_companion_y)),
    greatest(0, least(100, coalesce(p_normal_potions, 0))),
    greatest(0, least(100, coalesce(p_advanced_potions, 0))),
    greatest(0, least(100, coalesce(p_legendary_potions, 0))),
    now()
  )
  on conflict (account_id) do update set
    coins = excluded.coins,
    breath_level = excluded.breath_level,
    auto_level = excluded.auto_level,
    character_x = excluded.character_x,
    character_y = excluded.character_y,
    companion_unlocked = excluded.companion_unlocked,
    companion_summoned = excluded.companion_summoned,
    companion_level = excluded.companion_level,
    companion_x = excluded.companion_x,
    companion_y = excluded.companion_y,
    normal_potions = excluded.normal_potions,
    advanced_potions = excluded.advanced_potions,
    legendary_potions = excluded.legendary_potions,
    updated_at = now();

  return jsonb_build_object('saved', true);
end;
$$;

create or replace function public.sanggi_unlock_companion(p_session_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_state public.sanggi_game_states%rowtype;
begin
  select account_id into v_account_id
  from public.site_account_sessions
  where token = p_session_token and expires_at > now();
  if v_account_id is null then
    raise exception '로그인 세션이 만료되었습니다.';
  end if;

  select * into v_state
  from public.sanggi_game_states
  where account_id = v_account_id
  for update;
  if v_state.account_id is null then
    raise exception '상기 키우기 정보를 먼저 동기화하세요.';
  end if;
  if not v_state.companion_unlocked then
    if v_state.coins < 50000 then
      raise exception '코인이 부족합니다. 필요한 비용은 50,000원입니다.';
    end if;
    update public.sanggi_game_states
    set coins = coins - 50000,
        companion_unlocked = true,
        companion_summoned = true,
        updated_at = now()
    where account_id = v_account_id
    returning * into v_state;
  end if;
  return jsonb_build_object(
    'coins', v_state.coins::text,
    'companion_unlocked', v_state.companion_unlocked,
    'companion_summoned', v_state.companion_summoned,
    'companion_level', v_state.companion_level
  );
end;
$$;

revoke all on function public.sanggi_sync_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer, integer, integer) from public;
revoke all on function public.sanggi_save_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer, integer) from public;
revoke all on function public.sanggi_unlock_companion(uuid) from public;
grant execute on function public.sanggi_sync_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer, integer, integer) to anon, authenticated;
grant execute on function public.sanggi_save_state(uuid, bigint, integer, integer, numeric, numeric, boolean, boolean, integer, numeric, numeric, integer, integer, integer) to anon, authenticated;
grant execute on function public.sanggi_unlock_companion(uuid) to anon, authenticated;
grant execute on function public.sanggi_upgrade_player(uuid) to anon, authenticated;
grant execute on function public.sanggi_get_player_ranking(uuid) to anon, authenticated;
grant execute on function public.sanggi_use_potion(uuid, text) to anon, authenticated;
grant execute on function public.sanggi_get_outfits(uuid) to anon, authenticated;
grant execute on function public.sanggi_set_outfits(uuid, text, text) to anon, authenticated;
grant execute on function public.shop_use_missile(uuid, text, uuid) to anon, authenticated;
grant execute on function public.shop_discard_item(uuid, text, bigint) to anon, authenticated;
grant execute on function public.shop_send_letter(uuid, uuid, text) to anon, authenticated;
grant execute on function public.shop_change_nickname(uuid, uuid, text) to anon, authenticated;
grant execute on function public.shop_purchase_coin_box(uuid, text, bigint) to anon, authenticated;
grant execute on function public.shop_use_cash_box(uuid, text, uuid, bigint) to anon, authenticated;
grant execute on function public.shop_use_gambling_box(uuid) to anon, authenticated;
grant execute on function public.investment_link_account(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';

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

notify pgrst, 'reload schema';

-- 투표 취소/내 투표 조회
create or replace function public.record_cancel_poll_vote(
  p_poll_id uuid,
  p_voter_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option uuid;
begin
  delete from public.record_poll_votes
  where poll_id = p_poll_id and voter_key = p_voter_key
  returning option_id into v_option;
  if v_option is not null then
    update public.record_poll_options
    set vote_count = greatest(vote_count - 1, 0)
    where id = v_option;
  end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.record_get_my_poll_votes(p_voter_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(poll_id::text, option_id::text), '{}'::jsonb)
  from public.record_poll_votes
  where voter_key = p_voter_key;
$$;

revoke all on function public.record_cancel_poll_vote(uuid, text) from public;
revoke all on function public.record_get_my_poll_votes(text) from public;
grant execute on function public.record_cancel_poll_vote(uuid, text) to anon, authenticated;
grant execute on function public.record_get_my_poll_votes(text) to anon, authenticated;

notify pgrst, 'reload schema';
