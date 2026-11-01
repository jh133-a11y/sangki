-- Run after chess-schema.sql and allow-guest-chess.sql (the latter is optional).
begin;

create table if not exists public.chess_team_games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-F0-9]{6}$'),
  created_by uuid not null,
  capacity integer not null check (capacity between 3 and 4),
  status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  state jsonb not null default public.chess_initial(),
  moves jsonb not null default '[]'::jsonb,
  positions jsonb not null default '{}'::jsonb,
  result text check (result in ('w', 'b', 'draw')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chess_team_games_status_idx
  on public.chess_team_games(status, created_at desc);

create table if not exists public.chess_team_players (
  game_id uuid not null references public.chess_team_games(id) on delete cascade,
  account_id uuid not null,
  nickname text not null,
  team text not null check (team in ('w', 'b')),
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (game_id, account_id)
);
create index if not exists chess_team_players_turn_idx
  on public.chess_team_players(game_id, team, joined_at, account_id)
  where left_at is null;

create table if not exists public.chess_team_suggestions (
  id uuid primary key,
  game_id uuid not null references public.chess_team_games(id) on delete cascade,
  ply integer not null,
  requester_id uuid not null,
  recipient_id uuid not null,
  status text not null default 'open' check (status in ('open', 'suggested', 'expired')),
  proposed_move jsonb,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index if not exists chess_team_suggestions_one_open_idx
  on public.chess_team_suggestions(game_id, ply, requester_id)
  where status = 'open';
create index if not exists chess_team_suggestions_room_idx
  on public.chess_team_suggestions(game_id, ply desc);

alter table public.chess_team_games enable row level security;
alter table public.chess_team_players enable row level security;
alter table public.chess_team_suggestions enable row level security;
revoke all on public.chess_team_games, public.chess_team_players,
  public.chess_team_suggestions from public, anon, authenticated;

create or replace function public.chess_team_prune_expired()
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from public.chess_team_games
  where updated_at < now() - interval '24 hours';
end;
$$;

create or replace function public.chess_team_current_player(p_game_id uuid)
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare
  v_team text;
  v_player_count integer;
  v_turn_number integer;
  v_account uuid;
begin
  select g.state->>'turn', count(*)
  into v_team, v_player_count
  from public.chess_team_games g
  join public.chess_team_players p on p.game_id = g.id
    and p.team = g.state->>'turn' and p.left_at is null
  where g.id = p_game_id and g.status = 'active'
  group by g.state->>'turn';
  if v_player_count is null or v_player_count = 0 then return null; end if;

  select count(*) into v_turn_number
  from public.chess_team_games g
  cross join lateral jsonb_array_elements(g.moves) as entries(move)
  where g.id = p_game_id and entries.move->>'team' = v_team;

  select account_id into v_account
  from public.chess_team_players
  where game_id = p_game_id and team = v_team and left_at is null
  order by joined_at, account_id
  offset (v_turn_number % v_player_count) limit 1;
  return v_account;
end;
$$;

create or replace function public.chess_team_room_json(p_game_id uuid, p_account_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', g.id,
    'room_code', g.room_code,
    'capacity', g.capacity,
    'status', g.status,
    'state', g.state,
    'moves', g.moves,
    'result', g.result,
    'created_by', g.created_by,
    'is_host', g.created_by = p_account_id,
    'my_team', me.team,
    'my_ready', me.ready,
    'my_turn', g.status = 'active'
      and public.chess_team_current_player(g.id) = p_account_id,
    'current_player', public.chess_team_current_player(g.id),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', p.account_id,
        'nickname', p.nickname,
        'team', p.team,
        'ready', p.ready,
        'is_me', p.account_id = p_account_id,
        'last_seen_at', p.last_seen_at
      ) order by p.joined_at, p.account_id)
      from public.chess_team_players p
      where p.game_id = g.id and p.left_at is null
    ), '[]'::jsonb),
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'ply', s.ply,
        'status', s.status,
        'requester_id', s.requester_id,
        'requester_name', requester.nickname,
        'recipient_id', s.recipient_id,
        'recipient_name', recipient.nickname,
        'proposed_move', s.proposed_move
      ) order by s.created_at desc)
      from public.chess_team_suggestions s
      join public.chess_team_players requester
        on requester.game_id = s.game_id and requester.account_id = s.requester_id
      join public.chess_team_players recipient
        on recipient.game_id = s.game_id and recipient.account_id = s.recipient_id
      where s.game_id = g.id and s.ply = jsonb_array_length(g.moves)
        and s.status in ('open', 'suggested')
        and p_account_id in (s.requester_id, s.recipient_id)
    ), '[]'::jsonb)
  )
  from public.chess_team_games g
  join public.chess_team_players me
    on me.game_id = g.id and me.account_id = p_account_id and me.left_at is null
  where g.id = p_game_id;
$$;

create or replace function public.chess_team_create(
  p_session_token uuid, p_capacity integer
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.chess_account(p_session_token);
  v_nickname text;
  v_game public.chess_team_games;
  v_code text;
begin
  perform public.chess_team_prune_expired();
  if p_capacity not between 3 and 4 then raise exception '방 인원은 3명 또는 4명이어야 합니다.'; end if;
  select nickname into v_nickname from public.investment_users where client_id = v_account;
  if v_nickname is null then raise exception '온라인 대국에는 투자 닉네임이 필요합니다.'; end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.chess_team_games(room_code, created_by, capacity)
      values (v_code, v_account, p_capacity) returning * into v_game;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;
  insert into public.chess_team_players(game_id, account_id, nickname, team)
  values (v_game.id, v_account, v_nickname, 'w');
  return public.chess_team_room_json(v_game.id, v_account);
end;
$$;

create or replace function public.chess_team_join(
  p_session_token uuid, p_room_code text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.chess_account(p_session_token);
  v_nickname text;
  v_game public.chess_team_games;
  v_count integer;
  v_team text;
begin
  perform public.chess_team_prune_expired();
  select nickname into v_nickname from public.investment_users where client_id = v_account;
  if v_nickname is null then raise exception '온라인 대국에는 투자 닉네임이 필요합니다.'; end if;
  select * into v_game from public.chess_team_games
  where room_code = upper(trim(p_room_code)) for update;
  if v_game.id is null then raise exception '대국 방을 찾을 수 없습니다.'; end if;
  if exists (select 1 from public.chess_team_players
    where game_id = v_game.id and account_id = v_account and left_at is null) then
    update public.chess_team_players set last_seen_at = now()
      where game_id = v_game.id and account_id = v_account;
    return public.chess_team_room_json(v_game.id, v_account);
  end if;
  if v_game.status <> 'lobby' then raise exception '이미 시작한 대국에는 참가할 수 없습니다.'; end if;
  select count(*) into v_count from public.chess_team_players
    where game_id = v_game.id and left_at is null;
  if v_count >= v_game.capacity then raise exception '대국 방이 가득 찼습니다.'; end if;
  select case when count(*) filter (where team = 'w') <= count(*) filter (where team = 'b')
    then 'w' else 'b' end into v_team
  from public.chess_team_players where game_id = v_game.id and left_at is null;
  insert into public.chess_team_players(game_id, account_id, nickname, team)
  values (v_game.id, v_account, v_nickname, v_team);
  update public.chess_team_games set updated_at = now() where id = v_game.id;
  return public.chess_team_room_json(v_game.id, v_account);
end;
$$;

create or replace function public.chess_team_get(
  p_session_token uuid, p_game_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.chess_account(p_session_token); v_room jsonb;
begin
  perform public.chess_team_prune_expired();
  perform 1 from public.chess_team_games where id = p_game_id for update;
  update public.chess_team_players set last_seen_at = now()
  where game_id = p_game_id and account_id = v_account and left_at is null;
  update public.chess_team_games set updated_at = now()
  where id = p_game_id and exists (
    select 1 from public.chess_team_players
    where game_id = p_game_id and account_id = v_account and left_at is null
  );
  v_room := public.chess_team_room_json(p_game_id, v_account);
  if v_room is null then raise exception '참가 중인 온라인 대국을 찾을 수 없습니다.'; end if;
  return v_room;
end;
$$;

create or replace function public.chess_team_change(
  p_session_token uuid, p_game_id uuid, p_team text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.chess_account(p_session_token); v_game public.chess_team_games;
begin
  perform public.chess_team_prune_expired();
  if p_team not in ('w', 'b') then raise exception '팀을 선택하세요.'; end if;
  select * into v_game from public.chess_team_games where id = p_game_id for update;
  if v_game.id is null or v_game.status <> 'lobby' then raise exception '대기 중인 방에서만 팀을 변경할 수 있습니다.'; end if;
  if not exists (select 1 from public.chess_team_players where game_id = p_game_id
    and account_id = v_account and left_at is null) then raise exception '대국 참가자가 아닙니다.'; end if;
  if (select count(*) from public.chess_team_players where game_id = p_game_id
    and team = p_team and account_id <> v_account and left_at is null) >= 2 then
    raise exception '선택한 팀의 인원이 가득 찼습니다.';
  end if;
  update public.chess_team_players set team = p_team, ready = false, last_seen_at = now()
  where game_id = p_game_id and account_id = v_account;
  update public.chess_team_games set updated_at = now() where id = p_game_id;
  return public.chess_team_room_json(p_game_id, v_account);
end;
$$;

create or replace function public.chess_team_ready(
  p_session_token uuid, p_game_id uuid, p_ready boolean
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.chess_account(p_session_token); v_game public.chess_team_games;
begin
  perform public.chess_team_prune_expired();
  select * into v_game from public.chess_team_games where id = p_game_id for update;
  if v_game.id is null or v_game.status <> 'lobby' then raise exception '대기 중인 방이 아닙니다.'; end if;
  update public.chess_team_players set ready = p_ready, last_seen_at = now()
  where game_id = p_game_id and account_id = v_account and left_at is null;
  if not found then raise exception '대국 참가자가 아닙니다.'; end if;
  update public.chess_team_games set updated_at = now() where id = p_game_id;
  return public.chess_team_room_json(p_game_id, v_account);
end;
$$;

create or replace function public.chess_team_start(
  p_session_token uuid, p_game_id uuid
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.chess_account(p_session_token); v_game public.chess_team_games;
  v_count integer; v_positions jsonb;
begin
  perform public.chess_team_prune_expired();
  select * into v_game from public.chess_team_games where id = p_game_id for update;
  if v_game.id is null or v_game.status <> 'lobby' then raise exception '시작할 수 있는 대기 방이 아닙니다.'; end if;
  if v_game.created_by <> v_account then raise exception '방장만 대국을 시작할 수 있습니다.'; end if;
  select count(*) into v_count from public.chess_team_players where game_id = p_game_id and left_at is null;
  if v_count < 3 or v_count > v_game.capacity then raise exception '3명 또는 4명이 참가해야 시작할 수 있습니다.'; end if;
  if exists (select 1 from public.chess_team_players where game_id = p_game_id
    and left_at is null and not ready) then raise exception '모든 참가자가 준비해야 시작할 수 있습니다.'; end if;
  if not exists (select 1 from public.chess_team_players where game_id = p_game_id and team = 'w' and left_at is null)
    or not exists (select 1 from public.chess_team_players where game_id = p_game_id and team = 'b' and left_at is null) then
    raise exception '흑팀과 백팀에 모두 참가자가 있어야 합니다.';
  end if;
  v_positions := jsonb_build_object(public.chess_position(public.chess_initial()), 1);
  update public.chess_team_games set status = 'active', state = public.chess_initial(),
    moves = '[]'::jsonb, positions = v_positions, result = null, updated_at = now()
  where id = p_game_id;
  return public.chess_team_room_json(p_game_id, v_account);
end;
$$;

create or replace function public.chess_team_move(
  p_session_token uuid, p_game_id uuid, p_ply integer,
  p_from integer, p_to integer, p_promo text default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.chess_account(p_session_token);
  v_game public.chess_team_games;
  v_move jsonb;
  v_candidate jsonb;
  v_saved jsonb;
  v_state jsonb;
  v_moves jsonb;
  v_positions jsonb;
  v_key text;
  v_outcome text;
  v_turn text;
begin
  perform public.chess_team_prune_expired();
  select * into v_game from public.chess_team_games where id = p_game_id for update;
  if v_game.id is null then raise exception '온라인 대국을 찾을 수 없습니다.'; end if;
  if p_ply is null or p_from not between 0 and 63 or p_to not between 0 and 63 then
    raise exception '이동 정보를 확인하세요.';
  end if;
  if p_ply >= 0 and p_ply < jsonb_array_length(v_game.moves) then
    v_saved := v_game.moves->p_ply;
    if v_saved->>'player_id' = v_account::text
      and (v_saved->>'from')::integer = p_from and (v_saved->>'to')::integer = p_to
      and (v_saved->>'promo') is not distinct from p_promo then
      return public.chess_team_room_json(p_game_id, v_account);
    end if;
  end if;
  if v_game.status <> 'active' then raise exception '진행 중인 대국이 아닙니다.'; end if;
  if p_ply <> jsonb_array_length(v_game.moves) then raise exception '대국 상태가 바뀌었습니다. 방을 새로고침하세요.'; end if;
  v_turn := v_game.state->>'turn';
  if public.chess_team_current_player(p_game_id) is distinct from v_account then
    raise exception '현재 차례의 팀 참가자만 둘 수 있습니다.';
  end if;
  for v_candidate in select value from jsonb_array_elements(public.chess_legal(v_game.state)) loop
    if (v_candidate->>'from')::integer = p_from and (v_candidate->>'to')::integer = p_to
      and (v_candidate->>'promo') is not distinct from p_promo then
      v_move := v_candidate;
      exit;
    end if;
  end loop;
  if v_move is null then raise exception '허용되지 않는 체스 이동입니다.'; end if;
  v_move := v_move || jsonb_build_object('team', v_turn, 'player_id', v_account);
  v_state := public.chess_apply(v_game.state, v_move);
  v_moves := v_game.moves || jsonb_build_array(v_move);
  v_positions := v_game.positions;
  v_key := public.chess_position(v_state);
  v_positions := v_positions || jsonb_build_object(v_key, coalesce((v_positions->>v_key)::integer, 0) + 1);
  v_outcome := public.chess_outcome(v_state, v_positions);
  update public.chess_team_suggestions set status = 'expired'
  where game_id = p_game_id and status in ('open', 'suggested') and ply < jsonb_array_length(v_moves);
  update public.chess_team_games set state = v_state, moves = v_moves, positions = v_positions,
    status = case when v_outcome is null then 'active' else 'finished' end,
    result = case when v_outcome in ('w', 'b') then v_outcome when v_outcome = 'draw' then 'draw' else null end,
    updated_at = now()
  where id = p_game_id;
  return public.chess_team_room_json(p_game_id, v_account);
end;
$$;

create or replace function public.chess_team_request_suggestion(
  p_session_token uuid, p_game_id uuid, p_request_id uuid, p_recipient_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.chess_account(p_session_token);
  v_game public.chess_team_games;
  v_team text;
  v_recipient uuid;
begin
  perform public.chess_team_prune_expired();
  select * into v_game from public.chess_team_games where id = p_game_id for update;
  if v_game.id is null or v_game.status <> 'active' then raise exception '진행 중인 대국이 아닙니다.'; end if;
  if public.chess_team_current_player(p_game_id) is distinct from v_account then
    raise exception '현재 차례인 참가자만 수 제안을 요청할 수 있습니다.';
  end if;
  if p_request_id is null then raise exception '요청 식별자가 필요합니다.'; end if;
  select team into v_team from public.chess_team_players
  where game_id = p_game_id and account_id = v_account and left_at is null;
  if p_recipient_id is null then
    select account_id into v_recipient from public.chess_team_players
    where game_id = p_game_id and team = v_team and account_id <> v_account and left_at is null
    order by joined_at, account_id limit 1;
  else
    v_recipient := p_recipient_id;
  end if;
  if v_recipient is null or not exists (select 1 from public.chess_team_players
    where game_id = p_game_id and account_id = v_recipient and team = v_team
      and left_at is null and account_id <> v_account) then
    raise exception '제안을 요청할 팀원이 없습니다.';
  end if;
  if exists (select 1 from public.chess_team_suggestions where id = p_request_id
    and game_id = p_game_id and requester_id = v_account) then
    return public.chess_team_room_json(p_game_id, v_account);
  end if;
  update public.chess_team_suggestions set status = 'expired'
  where game_id = p_game_id and requester_id = v_account and status in ('open', 'suggested');
  insert into public.chess_team_suggestions(id, game_id, ply, requester_id, recipient_id)
  values (p_request_id, p_game_id, jsonb_array_length(v_game.moves), v_account, v_recipient);
  update public.chess_team_games set updated_at = now() where id = p_game_id;
  return public.chess_team_room_json(p_game_id, v_account);
end;
$$;

create or replace function public.chess_team_suggest_move(
  p_session_token uuid, p_game_id uuid, p_request_id uuid,
  p_from integer, p_to integer, p_promo text default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.chess_account(p_session_token);
  v_game public.chess_team_games;
  v_request public.chess_team_suggestions;
  v_move jsonb;
  v_candidate jsonb;
begin
  perform public.chess_team_prune_expired();
  select * into v_game from public.chess_team_games where id = p_game_id for update;
  select * into v_request from public.chess_team_suggestions
  where id = p_request_id and game_id = p_game_id for update;
  if v_game.id is null or v_game.status <> 'active' or v_request.id is null then
    raise exception '수 제안 요청이 만료되었습니다.';
  end if;
  if v_request.recipient_id <> v_account then raise exception '요청받은 팀원만 제안할 수 있습니다.'; end if;
  if v_request.status = 'suggested' then
    if v_request.proposed_move->>'from' = p_from::text
      and v_request.proposed_move->>'to' = p_to::text
      and (v_request.proposed_move->>'promo') is not distinct from p_promo then
      return public.chess_team_room_json(p_game_id, v_account);
    end if;
    raise exception '이미 다른 수를 제안했습니다.';
  end if;
  if v_request.status <> 'open' then raise exception '수 제안 요청이 만료되었습니다.'; end if;
  if v_request.ply <> jsonb_array_length(v_game.moves)
    or v_game.state->>'turn' <> (select team from public.chess_team_players
      where game_id = p_game_id and account_id = v_request.requester_id and left_at is null)
    or public.chess_team_current_player(p_game_id) <> v_request.requester_id then
    update public.chess_team_suggestions set status = 'expired' where id = p_request_id;
    raise exception '차례가 바뀌어 수 제안 요청이 만료되었습니다.';
  end if;
  for v_candidate in select value from jsonb_array_elements(public.chess_legal(v_game.state)) loop
    if (v_candidate->>'from')::integer = p_from and (v_candidate->>'to')::integer = p_to
      and (v_candidate->>'promo') is not distinct from p_promo then
      v_move := v_candidate;
      exit;
    end if;
  end loop;
  if v_move is null then raise exception '허용되지 않는 체스 수 제안입니다.'; end if;
  update public.chess_team_suggestions set status = 'suggested',
    proposed_move = v_move, responded_at = now() where id = p_request_id;
  update public.chess_team_games set updated_at = now() where id = p_game_id;
  return public.chess_team_room_json(p_game_id, v_account);
end;
$$;

create or replace function public.chess_team_leave(p_session_token uuid, p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.chess_account(p_session_token);
  v_game public.chess_team_games;
  v_team text;
begin
  perform public.chess_team_prune_expired();
  select * into v_game from public.chess_team_games where id = p_game_id for update;
  if v_game.id is null then raise exception '온라인 대국을 찾을 수 없습니다.'; end if;
  select team into v_team from public.chess_team_players
  where game_id = p_game_id and account_id = v_account and left_at is null for update;
  if v_team is null then raise exception '현재 방 참가자가 아닙니다.'; end if;
  if v_game.status = 'lobby' and v_game.created_by = v_account then
    delete from public.chess_team_games where id = p_game_id;
    return jsonb_build_object('left', true);
  end if;
  update public.chess_team_players set left_at = now(), ready = false
  where game_id = p_game_id and account_id = v_account;
  update public.chess_team_suggestions set status = 'expired'
  where game_id = p_game_id and status in ('open', 'suggested')
    and (requester_id = v_account or recipient_id = v_account);
  if v_game.status = 'lobby' then
    update public.chess_team_games set updated_at = now() where id = p_game_id;
    return jsonb_build_object('left', true);
  end if;
  if v_game.status = 'active' and not exists (select 1 from public.chess_team_players
    where game_id = p_game_id and team = v_team and left_at is null) then
    update public.chess_team_games set status = 'finished',
      result = case when v_team = 'w' then 'b' else 'w' end, updated_at = now()
    where id = p_game_id;
  end if;
  return jsonb_build_object('left', true);
end;
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'chess\_team\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
  end loop;
end;
$$;

revoke all on function public.chess_team_prune_expired() from public, anon, authenticated;
revoke all on function public.chess_team_current_player(uuid) from public, anon, authenticated;
revoke all on function public.chess_team_room_json(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chess_team_create(uuid, integer) to anon, authenticated;
grant execute on function public.chess_team_join(uuid, text) to anon, authenticated;
grant execute on function public.chess_team_get(uuid, uuid) to anon, authenticated;
grant execute on function public.chess_team_change(uuid, uuid, text) to anon, authenticated;
grant execute on function public.chess_team_ready(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.chess_team_start(uuid, uuid) to anon, authenticated;
grant execute on function public.chess_team_move(uuid, uuid, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.chess_team_request_suggestion(uuid, uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.chess_team_suggest_move(uuid, uuid, uuid, integer, integer, text) to anon, authenticated;
grant execute on function public.chess_team_leave(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
