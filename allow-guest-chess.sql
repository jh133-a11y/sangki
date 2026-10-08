-- Run after chess-schema.sql. Guest access follows the site's investment ID/nickname model.
begin;

alter table public.chess_games
  drop constraint if exists chess_games_account_id_fkey;

create table if not exists public.chess_guest_sessions (
  token uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days')
);
alter table public.chess_guest_sessions enable row level security;
revoke all on public.chess_guest_sessions from public, anon, authenticated;

create or replace function public.chess_guest_session(p_client_id uuid, p_nickname text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_token uuid;
begin
  if p_client_id is null or nullif(trim(p_nickname), '') is null
    or not exists (
      select 1 from public.investment_users
      where client_id = p_client_id and nickname = trim(p_nickname)
    ) then
    raise exception '메인에서 비회원 투자 고유 닉네임을 먼저 설정하세요.';
  end if;
  if exists (select 1 from public.site_accounts where id = p_client_id) then
    raise exception '계정에 연결된 투자 정보입니다. 로그인하세요.';
  end if;
  perform 1 from public.investment_users where client_id = p_client_id for update;
  delete from public.chess_guest_sessions where client_id = p_client_id and expires_at <= now();
  select token into v_token from public.chess_guest_sessions
  where client_id = p_client_id and expires_at > now()
  order by expires_at desc limit 1;
  if v_token is null then
    insert into public.chess_guest_sessions(client_id)
    values(p_client_id) returning token into v_token;
  end if;
  return jsonb_build_object('session_token', v_token, 'account_id', p_client_id);
end;
$$;

create or replace function public.chess_account(p_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_account uuid;
begin
  select account_id into v_account from public.site_account_sessions
  where token = p_token and expires_at > now();
  if v_account is null then
    select s.client_id into v_account from public.chess_guest_sessions s
    where s.token = p_token and s.expires_at > now()
      and not exists (select 1 from public.site_accounts a where a.id = s.client_id);
  end if;
  if v_account is null then
    raise exception '체스 세션이 만료되었습니다. 페이지를 새로고침하거나 메인에서 로그인하세요.' using errcode = '28000';
  end if;
  perform 1 from public.investment_users where client_id = v_account for update;
  return v_account;
end;
$$;

revoke all on function public.chess_account(uuid) from public, anon, authenticated;
revoke all on function public.chess_guest_session(uuid, text) from public;
grant execute on function public.chess_guest_session(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
