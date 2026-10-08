-- Run after supabase-schema.sql. No dependency on music-schema.sql.
begin;

create table if not exists public.chess_games (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.site_accounts(id) on delete cascade,
  level integer not null check (level between 1 and 3),
  side text not null check (side in ('w', 'b')),
  state jsonb not null,
  moves jsonb not null default '[]',
  positions jsonb not null default '{}',
  result text check (result in ('win', 'draw', 'loss', 'cancelled')),
  reward bigint not null default 0,
  reward_claimed boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists chess_games_account_idx on public.chess_games(account_id);
create unique index if not exists chess_games_active_idx on public.chess_games(account_id) where result is null;
alter table public.chess_games enable row level security;
revoke all on public.chess_games from public, anon, authenticated;

create or replace function public.chess_account(p_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_account uuid;
begin
  select account_id into v_account from public.site_account_sessions
  where token = p_token and expires_at > now();
  if v_account is null then
    raise exception '로그인 세션이 만료되었습니다. 메인에서 다시 로그인하세요.' using errcode = '28000';
  end if;
  return v_account;
end;
$$;

create or replace function public.chess_initial()
returns jsonb language sql immutable set search_path = public
as $$
  select jsonb_build_object(
    'board', 'rnbqkbnrpppppppp' || repeat(' ',32) || 'PPPPPPPPRNBQKBNR',
    'turn','w','castling','KQkq','ep',-1,'half',0,'full',1
  );
$$;

create or replace function public.chess_color(p_piece text)
returns text language sql immutable set search_path = public
as $$
  select case when p_piece is null or p_piece='' or p_piece=' ' then null
    when p_piece=upper(p_piece) then 'w' else 'b' end;
$$;

create or replace function public.chess_attacked(p_board text, p_square integer, p_by text)
returns boolean language plpgsql immutable set search_path = public
as $$
declare
  i integer; r integer; c integer; dr integer; dc integer;
  rr integer; cc integer; piece text; kind text;
begin
  if p_square < 0 then return true; end if;
  r := p_square / 8; c := p_square % 8;
  for i in 0..63 loop
    piece := substr(p_board,i+1,1);
    if public.chess_color(piece) is distinct from p_by then continue; end if;
    kind := lower(piece); dr := r-i/8; dc := c-i%8;
    if kind='p' and dr=(case when p_by='w' then -1 else 1 end) and abs(dc)=1 then return true; end if;
    if kind='n' and ((abs(dr)=2 and abs(dc)=1) or (abs(dr)=1 and abs(dc)=2)) then return true; end if;
    if kind='k' and greatest(abs(dr),abs(dc))=1 then return true; end if;
    if (kind in ('b','q') and abs(dr)=abs(dc) and dr<>0)
      or (kind in ('r','q') and ((dr=0 and dc<>0) or (dc=0 and dr<>0))) then
      rr := i/8+sign(dr)::integer; cc := i%8+sign(dc)::integer;
      while rr<>r or cc<>c loop
        exit when substr(p_board,rr*8+cc+1,1)<>' ';
        rr := rr+sign(dr)::integer; cc := cc+sign(dc)::integer;
      end loop;
      if rr=r and cc=c then return true; end if;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.chess_check(p_state jsonb, p_side text)
returns boolean language sql immutable set search_path = public
as $$
  select public.chess_attacked(p_state->>'board',
    strpos(p_state->>'board',case when p_side='w' then 'K' else 'k' end)-1,
    case when p_side='w' then 'b' else 'w' end);
$$;

create or replace function public.chess_apply(p_state jsonb, p_move jsonb)
returns jsonb language plpgsql immutable set search_path = public
as $$
declare
  board text := p_state->>'board'; rights text := p_state->>'castling';
  side text := p_state->>'turn'; source integer := (p_move->>'from')::integer;
  target integer := (p_move->>'to')::integer;
  piece text := p_move->>'piece'; placed text; rownum integer;
  sq integer; flag text;
begin
  placed := case when p_move ? 'promo' then
    case when side='w' then upper(p_move->>'promo') else p_move->>'promo' end else piece end;
  board := overlay(board placing placed from target+1 for 1);
  board := overlay(board placing ' ' from source+1 for 1);
  if coalesce((p_move->>'enPassant')::boolean,false) then
    board := overlay(board placing ' ' from target+(case when side='w' then 8 else -8 end)+1 for 1);
  end if;
  if p_move ? 'castle' then
    rownum := case when side='w' then 7 else 0 end;
    if p_move->>'castle'='K' then
      board := overlay(board placing substr(board,rownum*8+8,1) from rownum*8+6 for 1);
      board := overlay(board placing ' ' from rownum*8+8 for 1);
    else
      board := overlay(board placing substr(board,rownum*8+1,1) from rownum*8+4 for 1);
      board := overlay(board placing ' ' from rownum*8+1 for 1);
    end if;
  end if;
  if piece='K' then rights := replace(replace(rights,'K',''),'Q',''); end if;
  if piece='k' then rights := replace(replace(rights,'k',''),'q',''); end if;
  foreach sq in array array[63,56,7,0] loop
    flag := case sq when 63 then 'K' when 56 then 'Q' when 7 then 'k' else 'q' end;
    if source=sq or target=sq then rights := replace(rights,flag,''); end if;
  end loop;
  return jsonb_build_object('board',board,'turn',case when side='w' then 'b' else 'w' end,
    'castling',rights,'ep',case when coalesce((p_move->>'double')::boolean,false) then (source+target)/2 else -1 end,
    'half',case when lower(piece)='p' or p_move->>'capture' is not null then 0 else (p_state->>'half')::integer+1 end,
    'full',(p_state->>'full')::integer + case when side='b' then 1 else 0 end);
end;
$$;

create or replace function public.chess_legal(p_state jsonb)
returns jsonb language plpgsql immutable set search_path = public
as $$
declare
  board text := p_state->>'board'; side text := p_state->>'turn';
  moves jsonb := '[]'; legal jsonb := '[]'; m jsonb;
  i integer; r integer; c integer; rr integer; cc integer; dest integer;
  dir integer; rownum integer; dr integer; dc integer; step integer; offset_pair integer[];
  piece text; kind text; target text; promo text; flag text; rook text;
  candidate jsonb; diagonal boolean; straight boolean;
begin
  for i in 0..63 loop
    piece := substr(board,i+1,1);
    if public.chess_color(piece) is distinct from side then continue; end if;
    kind := lower(piece); r:=i/8; c:=i%8;
    if kind='p' then
      dir := case when side='w' then -1 else 1 end;
      for dc in -1..1 loop
        rr:=r+dir; cc:=c+dc;
        if rr<0 or rr>7 or cc<0 or cc>7 then continue; end if;
        dest:=rr*8+cc; target:=substr(board,dest+1,1);
        candidate:=jsonb_build_object('from',i,'to',dest,'piece',piece,'capture',null);
        if dc=0 then
          if target<>' ' then continue; end if;
        elsif target=' ' and dest=(p_state->>'ep')::integer then
          if substr(board,dest-dir*8+1,1)<>(case when side='w' then 'p' else 'P' end) then continue; end if;
          candidate:=candidate || jsonb_build_object('enPassant',true,'capture',case when side='w' then 'p' else 'P' end);
        elsif public.chess_color(target) is distinct from (case when side='w' then 'b' else 'w' end)
            or lower(target)='k' then continue;
        else candidate:=candidate || jsonb_build_object('capture',target);
        end if;
        if rr in (0,7) then
          foreach promo in array array['q','r','b','n'] loop
            moves:=moves || jsonb_build_array(candidate || jsonb_build_object('promo',promo));
          end loop;
        else moves:=moves || jsonb_build_array(candidate);
        end if;
        if dc=0 and r=(case when side='w' then 6 else 1 end) and substr(board,(r+2*dir)*8+c+1,1)=' ' then
          moves:=moves || jsonb_build_array(jsonb_build_object('from',i,'to',(r+2*dir)*8+c,'piece',piece,'capture',null,'double',true));
        end if;
      end loop;
    else
      for dr in -2..2 loop
        for dc in -2..2 loop
          if dr=0 and dc=0 then continue; end if;
          diagonal:=abs(dr)=1 and abs(dc)=1;
          straight:=(dr=0 and abs(dc)=1) or (dc=0 and abs(dr)=1);
          if not ((kind='n' and abs(dr)*abs(dc)=2)
            or (kind='k' and greatest(abs(dr),abs(dc))=1)
            or (kind in ('b','q') and diagonal) or (kind in ('r','q') and straight)) then continue; end if;
          for step in 1..7 loop
            rr:=r+dr*step; cc:=c+dc*step;
            exit when rr<0 or rr>7 or cc<0 or cc>7;
            dest:=rr*8+cc; target:=substr(board,dest+1,1);
            exit when public.chess_color(target)=side or lower(target)='k';
            moves:=moves || jsonb_build_array(jsonb_build_object('from',i,'to',dest,'piece',piece,
              'capture',case when target=' ' then null else target end));
            exit when target<>' ' or kind in ('k','n');
          end loop;
        end loop;
      end loop;
      if kind='k' and i=(case when side='w' then 60 else 4 end) and not public.chess_check(p_state,side) then
        rownum:=case when side='w' then 7 else 0 end;
        rook:=case when side='w' then 'R' else 'r' end;
        flag:=case when side='w' then 'K' else 'k' end;
        if strpos(p_state->>'castling',flag)>0 and substr(board,rownum*8+8,1)=rook
          and substr(board,rownum*8+6,2)='  '
          and not public.chess_attacked(board,rownum*8+5,case when side='w' then 'b' else 'w' end)
          and not public.chess_attacked(board,rownum*8+6,case when side='w' then 'b' else 'w' end) then
          moves:=moves || jsonb_build_array(jsonb_build_object('from',i,'to',rownum*8+6,'piece',piece,'capture',null,'castle','K'));
        end if;
        flag:=case when side='w' then 'Q' else 'q' end;
        if strpos(p_state->>'castling',flag)>0 and substr(board,rownum*8+1,1)=rook
          and substr(board,rownum*8+2,3)='   '
          and not public.chess_attacked(board,rownum*8+3,case when side='w' then 'b' else 'w' end)
          and not public.chess_attacked(board,rownum*8+2,case when side='w' then 'b' else 'w' end) then
          moves:=moves || jsonb_build_array(jsonb_build_object('from',i,'to',rownum*8+2,'piece',piece,'capture',null,'castle','Q'));
        end if;
      end if;
    end if;
  end loop;
  for m in select value from jsonb_array_elements(moves) loop
    if not public.chess_check(public.chess_apply(p_state,m),side) then
      legal:=legal || jsonb_build_array(m);
    end if;
  end loop;
  return legal;
end;
$$;

create or replace function public.chess_value(p_piece text)
returns integer language sql immutable set search_path = public
as $$ select case lower(p_piece) when 'p' then 100 when 'n' then 320 when 'b' then 330 when 'r' then 500 when 'q' then 900 else 0 end; $$;

create or replace function public.chess_evaluate(p_state jsonb)
returns double precision language plpgsql immutable set search_path = public
as $$
declare score double precision:=0; value double precision; center double precision; i integer; piece text; kind text;
begin
  for i in 0..63 loop
    piece:=substr(p_state->>'board',i+1,1);
    if piece=' ' then continue; end if;
    kind:=lower(piece); value:=public.chess_value(piece);
    center:=6-(abs(3.5-i/8)+abs(3.5-i%8))*1.5;
    if kind='p' then
      value:=value+(case when public.chess_color(piece)='w' then 7-i/8 else i/8 end)*6
        + case when i%8 between 2 and 5 then center else 0 end;
    elsif kind in ('n','b') then value:=value+center*2;
    elsif kind='q' then value:=value+center*.5;
    end if;
    score:=score+value*(case when public.chess_color(piece)='w' then 1 else -1 end);
  end loop;
  return score;
end;
$$;

create or replace function public.chess_search(p_state jsonb,p_depth integer,p_alpha double precision,p_beta double precision)
returns double precision language plpgsql immutable set search_path = public
as $$
declare moves jsonb; m jsonb; best double precision; score double precision;
begin
  if p_depth=0 and not public.chess_check(p_state,p_state->>'turn') then
    return public.chess_evaluate(p_state);
  end if;
  moves:=public.chess_legal(p_state);
  if jsonb_array_length(moves)=0 then
    return case when public.chess_check(p_state,p_state->>'turn') then
      case when p_state->>'turn'='w' then -100000-p_depth else 100000+p_depth end else 0 end;
  end if;
  if p_depth=0 then return public.chess_evaluate(p_state); end if;
  best:=case when p_state->>'turn'='w' then '-Infinity'::double precision else 'Infinity'::double precision end;
  for m in select value from jsonb_array_elements(moves)
    order by (10*public.chess_value(value->>'capture')-case when value->>'capture' is null then 0 else public.chess_value(value->>'piece') end
      +case when value ? 'promo' then 800 else 0 end) desc loop
    score:=public.chess_search(public.chess_apply(p_state,m),p_depth-1,p_alpha,p_beta);
    if p_state->>'turn'='w' then best:=greatest(best,score); p_alpha:=greatest(p_alpha,best);
    else best:=least(best,score); p_beta:=least(p_beta,best);
    end if;
    exit when p_alpha>=p_beta;
  end loop;
  return best;
end;
$$;

create or replace function public.chess_ai(p_state jsonb,p_level integer)
returns jsonb language plpgsql volatile set search_path = public
as $$
declare
  moves jsonb:=public.chess_legal(p_state); m jsonb; best_moves jsonb:='[]';
  score double precision; best double precision;
begin
  if jsonb_array_length(moves)=0 then return null; end if;
  if p_level=1 and random()<.35 then return moves->floor(random()*jsonb_array_length(moves))::integer; end if;
  best:=case when p_state->>'turn'='w' then '-Infinity'::double precision else 'Infinity'::double precision end;
  for m in select value from jsonb_array_elements(moves)
    order by (10*public.chess_value(value->>'capture')-case when value->>'capture' is null then 0 else public.chess_value(value->>'piece') end
      +case when value ? 'promo' then 800 else 0 end) desc loop
    score:=public.chess_search(public.chess_apply(p_state,m),p_level-1,
      case when p_state->>'turn'='w' then best else '-Infinity'::double precision end,
      case when p_state->>'turn'='b' then best else 'Infinity'::double precision end);
    if (p_state->>'turn'='w' and score>best) or (p_state->>'turn'='b' and score<best) then
      best:=score; best_moves:=jsonb_build_array(m);
    end if;
  end loop;
  return best_moves->floor(random()*jsonb_array_length(best_moves))::integer;
end;
$$;

create or replace function public.chess_position(p_state jsonb)
returns text language sql immutable set search_path = public
as $$ select (p_state->>'board') || (p_state->>'turn') || (p_state->>'castling') || (p_state->>'ep'); $$;

create or replace function public.chess_outcome(p_state jsonb,p_positions jsonb)
returns text language plpgsql immutable set search_path = public
as $$
declare rest text; moves jsonb:=public.chess_legal(p_state);
begin
  if jsonb_array_length(moves)=0 then
    if public.chess_check(p_state,p_state->>'turn') then
      return case when p_state->>'turn'='w' then 'b' else 'w' end;
    end if;
    return 'draw';
  end if;
  rest:=regexp_replace(p_state->>'board','[ kK]','','g');
  if rest='' or (length(rest)=1 and lower(rest) in ('b','n')) then return 'draw'; end if;
  if (p_state->>'half')::integer>=100
    or coalesce((p_positions->>public.chess_position(p_state))::integer,0)>=3 then return 'draw'; end if;
  return null;
end;
$$;

create or replace function public.chess_finish(p_id uuid,p_outcome text)
returns void language plpgsql security definer set search_path = public
as $$
declare g public.chess_games; amount bigint:=0; final_result text; owned bigint; claimed boolean:=false;
begin
  select * into g from public.chess_games where id=p_id for update;
  if g.id is null or g.result is not null then return; end if;
  final_result:=case when p_outcome='draw' then 'draw' when p_outcome=g.side then 'win'
    when p_outcome='cancelled' then 'cancelled' else 'loss' end;
  if final_result='win' then
    amount:=case g.level when 1 then 1 when 2 then 5 else 15 end;
    insert into public.investment_shop_items(client_id,item_type,quantity)
    values(g.account_id,'cash_box',0) on conflict do nothing;
    select quantity into owned from public.investment_shop_items
    where client_id=g.account_id and item_type='cash_box' for update;
    if owned+amount<=100 then
      update public.investment_shop_items set quantity=quantity+amount
      where client_id=g.account_id and item_type='cash_box';
      claimed:=true;
    end if;
  end if;
  update public.chess_games set result=final_result, reward=amount, reward_claimed=claimed, finished_at=now() where id=p_id;
end;
$$;

create or replace function public.chess_profile(p_session_token uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare account uuid:=public.chess_account(p_session_token); wins integer; draws integer; losses integer; active jsonb;
begin
  select count(*) filter (where result='win'),count(*) filter (where result='draw'),count(*) filter (where result='loss')
  into wins,draws,losses from public.chess_games where account_id=account;
  select jsonb_build_object('id',id,'level',level,'side',side,'state',state,'moves',moves,'result',result,'reward',reward::text)
  into active from public.chess_games where account_id=account and result is null;
  return jsonb_build_object('account_id',account,
    'nickname',(select nickname from public.investment_users where client_id=account),
    'player_level',coalesce((select player_level from public.sanggi_game_states where account_id=account),1),
    'wins',wins,'draws',draws,'losses',losses,
    'win_rate',case when wins+draws+losses=0 then 0 else round(100.0*wins/(wins+draws+losses),1) end,
    'pending_boxes',(select coalesce(sum(reward),0) from public.chess_games where account_id=account and not reward_claimed),
    'active',active);
end;
$$;

create or replace function public.chess_game_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('id',id,'level',level,'side',side,'state',state,'moves',moves,'result',result,
    'reward',reward::text,'reward_claimed',reward_claimed)
  from public.chess_games where id=p_id;
$$;

create or replace function public.chess_claim_rewards(p_session_token uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare account uuid:=public.chess_account(p_session_token); g public.chess_games; owned bigint; total bigint:=0;
begin
  perform 1 from public.site_accounts where id=account for update;
  for g in select * from public.chess_games
    where account_id=account and reward>0 and not reward_claimed order by created_at,id for update loop
    insert into public.investment_shop_items(client_id,item_type,quantity)
    values(account,'cash_box',0) on conflict do nothing;
    select quantity into owned from public.investment_shop_items
    where client_id=account and item_type='cash_box' for update;
    if owned+g.reward>100 then continue; end if;
    update public.investment_shop_items set quantity=quantity+g.reward where client_id=account and item_type='cash_box';
    update public.chess_games set reward_claimed=true where id=g.id;
    total:=total+g.reward;
  end loop;
  return jsonb_build_object('claimed',total,'profile',public.chess_profile(p_session_token));
end;
$$;

create or replace function public.chess_start(p_session_token uuid,p_level integer,p_side text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  account uuid:=public.chess_account(p_session_token); g public.chess_games;
  s jsonb:=public.chess_initial(); moves jsonb:='[]'; m jsonb; positions jsonb;
begin
  if p_level is null or p_level not between 1 and 3 or p_side is null or p_side not in ('w','b') then
    raise exception '난이도와 색을 확인하세요.';
  end if;
  perform 1 from public.site_accounts where id=account for update;
  if not exists(select 1 from public.investment_users where client_id=account) then
    raise exception '메인에서 투자 고유 닉네임을 먼저 설정하세요.';
  end if;
  select * into g from public.chess_games where account_id=account and result is null for update;
  if g.id is not null then
    perform public.chess_finish(g.id,case when jsonb_array_length(g.moves)=0 then 'cancelled' else 'abandoned' end);
  end if;
  positions:=jsonb_build_object(public.chess_position(s),1);
  if p_side='b' then
    m:=public.chess_ai(s,p_level); s:=public.chess_apply(s,m); moves:=jsonb_build_array(m);
    positions:=positions || jsonb_build_object(public.chess_position(s),1);
  end if;
  insert into public.chess_games(account_id,level,side,state,moves,positions)
  values(account,p_level,p_side,s,moves,positions) returning * into g;
  return public.chess_game_json(g.id);
end;
$$;

create or replace function public.chess_move(
  p_session_token uuid,p_game_id uuid,p_ply integer,p_from integer,p_to integer,p_promo text default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  account uuid:=public.chess_account(p_session_token); g public.chess_games; m jsonb; chosen jsonb;
  s jsonb; v_positions jsonb; key text; outcome text; all_moves jsonb; saved jsonb;
begin
  select * into g from public.chess_games where id=p_game_id and account_id=account for update;
  if g.id is null then raise exception '내 체스 경기를 찾을 수 없습니다.'; end if;
  if p_ply is null or p_from is null or p_to is null then raise exception '이동 정보를 확인하세요.'; end if;
  if p_ply<jsonb_array_length(g.moves) and p_ply>=0 then
    saved:=g.moves->p_ply;
    if (saved->>'from')::integer=p_from and (saved->>'to')::integer=p_to
      and (saved->>'promo') is not distinct from p_promo then return public.chess_game_json(g.id); end if;
  end if;
  if g.result is not null then raise exception '이미 끝난 경기입니다.'; end if;
  if p_ply<>jsonb_array_length(g.moves) or g.state->>'turn'<>g.side then
    raise exception '경기 상태가 바뀌었습니다. 서버 경기 불러오기를 눌러 주세요.';
  end if;
  for m in select value from jsonb_array_elements(public.chess_legal(g.state)) loop
    if (m->>'from')::integer=p_from and (m->>'to')::integer=p_to
      and (m->>'promo') is not distinct from p_promo then chosen:=m; exit; end if;
  end loop;
  if chosen is null then raise exception '허용되지 않는 체스 이동입니다.'; end if;
  s:=public.chess_apply(g.state,chosen); all_moves:=g.moves || jsonb_build_array(chosen);
  v_positions:=g.positions; key:=public.chess_position(s);
  v_positions:=v_positions || jsonb_build_object(key,coalesce((v_positions->>key)::integer,0)+1);
  outcome:=public.chess_outcome(s,v_positions);
  if outcome is null then
    m:=public.chess_ai(s,g.level); s:=public.chess_apply(s,m); all_moves:=all_moves || jsonb_build_array(m);
    key:=public.chess_position(s);
    v_positions:=v_positions || jsonb_build_object(key,coalesce((v_positions->>key)::integer,0)+1);
    outcome:=public.chess_outcome(s,v_positions);
  end if;
  update public.chess_games set state=s,moves=all_moves,positions=v_positions where id=g.id;
  if outcome is not null then perform public.chess_finish(g.id,outcome); end if;
  return public.chess_game_json(g.id);
end;
$$;

create or replace function public.chess_undo(p_session_token uuid,p_game_id uuid,p_ply integer)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare account uuid:=public.chess_account(p_session_token); g public.chess_games; s jsonb:=public.chess_initial();
  m jsonb; v_moves jsonb:='[]'; v_positions jsonb; key text; keep integer; i integer;
begin
  select * into g from public.chess_games where id=p_game_id and account_id=account for update;
  if g.id is null then raise exception '내 체스 경기를 찾을 수 없습니다.'; end if;
  if g.level<>1 then raise exception '무르기는 쉬움 난이도에서만 가능합니다.'; end if;
  if g.result is not null then raise exception '끝난 경기는 무를 수 없습니다.'; end if;
  if p_ply is null or p_ply<>jsonb_array_length(g.moves) then raise exception '경기 상태가 바뀌었습니다. 다시 불러오세요.'; end if;
  keep:=jsonb_array_length(g.moves)-2;
  if keep<(case when g.side='b' then 1 else 0 end) then raise exception '무를 수 있는 내 이동이 없습니다.'; end if;
  v_positions:=jsonb_build_object(public.chess_position(s),1);
  for i in 0..keep-1 loop
    m:=g.moves->i; s:=public.chess_apply(s,m); v_moves:=v_moves || jsonb_build_array(m);
    key:=public.chess_position(s);
    v_positions:=v_positions || jsonb_build_object(key,coalesce((v_positions->>key)::integer,0)+1);
  end loop;
  update public.chess_games set state=s,moves=v_moves,positions=v_positions where id=g.id;
  return public.chess_game_json(g.id);
end;
$$;

create or replace function public.chess_get_game(p_session_token uuid,p_game_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare account uuid:=public.chess_account(p_session_token);
begin
  if not exists(select 1 from public.chess_games where id=p_game_id and account_id=account) then
    raise exception '내 체스 경기를 찾을 수 없습니다.';
  end if;
  return public.chess_game_json(p_game_id);
end;
$$;

create or replace function public.chess_leave(p_session_token uuid,p_game_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare account uuid:=public.chess_account(p_session_token); g public.chess_games;
begin
  select * into g from public.chess_games where id=p_game_id and account_id=account for update;
  if g.id is null then raise exception '내 체스 경기를 찾을 수 없습니다.'; end if;
  if g.result is null then
    perform public.chess_finish(g.id,case when jsonb_array_length(g.moves)=0 then 'cancelled' else 'abandoned' end);
  end if;
  return true;
end;
$$;

-- Keep all rules, AI and payout helpers inaccessible to browser callers.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'chess\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  end loop;
end;
$$;
grant execute on function public.chess_profile(uuid) to anon, authenticated;
grant execute on function public.chess_start(uuid,integer,text) to anon, authenticated;
grant execute on function public.chess_move(uuid,uuid,integer,integer,integer,text) to anon, authenticated;
grant execute on function public.chess_undo(uuid,uuid,integer) to anon, authenticated;
grant execute on function public.chess_get_game(uuid,uuid) to anon, authenticated;
grant execute on function public.chess_leave(uuid,uuid) to anon, authenticated;
grant execute on function public.chess_claim_rewards(uuid) to anon, authenticated;

notify pgrst,'reload schema';
commit;
