-- Run after the existing site schema. Prices use investment cash, not Sanggi coins.
begin;
create table if not exists public.sanggi_backgrounds (
  client_id uuid not null references public.investment_users(client_id) on delete cascade,
  background text not null check (background in ('old_village', 'space')),
  equipped boolean not null default false,
  primary key(client_id, background)
);
create unique index if not exists sanggi_background_equipped
  on public.sanggi_backgrounds(client_id) where equipped;
alter table public.sanggi_backgrounds enable row level security;
revoke all on public.sanggi_backgrounds from public, anon, authenticated;

create or replace function public.sanggi_background_action(
  p_client_id uuid, p_nickname text, p_session_token uuid default null,
  p_action text default 'get', p_background text default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_cash bigint; v_price bigint; v_equipped boolean;
begin
  if p_session_token is not null then
    select account_id into v_id from public.site_account_sessions
    where token=p_session_token and expires_at>now();
    if v_id is null then raise exception '로그인 세션이 만료되었습니다.'; end if;
  else
    if exists(select 1 from public.site_accounts where id=p_client_id) then
      raise exception '계정에 연결된 투자 정보입니다. 로그인하세요.';
    end if;
    select client_id into v_id from public.investment_users
    where client_id=p_client_id and nickname=trim(p_nickname);
    if v_id is null then raise exception '메인에서 투자 고유 닉네임을 먼저 설정하세요.'; end if;
  end if;
  select cash into v_cash from public.investment_users where client_id=v_id for update;
  if v_cash is null then raise exception '투자 정보를 찾을 수 없습니다.'; end if;
  if p_action is null or p_action not in ('get','buy','toggle') then
    raise exception '배경 요청을 확인하세요.';
  end if;
  if p_action<>'get' then
    if p_background is null or p_background not in ('old_village','space') then
      raise exception '배경을 확인하세요.';
    end if;
    if p_action='buy' then
      v_price:=case p_background when 'old_village' then 1000000000 else 5000000000 end;
      if not exists(select 1 from public.sanggi_backgrounds where client_id=v_id and background=p_background) then
        if v_cash<v_price then raise exception '보유 현금이 부족합니다.'; end if;
        update public.investment_users set cash=cash-v_price where client_id=v_id;
        insert into public.sanggi_backgrounds(client_id,background) values(v_id,p_background);
      end if;
    else
      select equipped into v_equipped from public.sanggi_backgrounds
      where client_id=v_id and background=p_background;
      if v_equipped is null then raise exception '배경을 먼저 구매하세요.'; end if;
      update public.sanggi_backgrounds set equipped=false where client_id=v_id and equipped;
      if not v_equipped then
        update public.sanggi_backgrounds set equipped=true where client_id=v_id and background=p_background;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'client_id',v_id,
    'cash',(select cash::text from public.investment_users where client_id=v_id),
    'owned',coalesce((select jsonb_agg(background order by background) from public.sanggi_backgrounds where client_id=v_id),'[]'::jsonb),
    'equipped',(select background from public.sanggi_backgrounds where client_id=v_id and equipped),
    'bonus',coalesce((select sum(case background when 'old_village' then 1000 else 3000 end) from public.sanggi_backgrounds where client_id=v_id),0)
  );
end;
$$;
revoke all on function public.sanggi_background_action(uuid,text,uuid,text,text) from public;
grant execute on function public.sanggi_background_action(uuid,text,uuid,text,text) to anon,authenticated;

-- Preserve purchased backgrounds when the existing guest investment is linked to an account.
create or replace function public.investment_link_account(
  p_session_token uuid, p_old_client_id uuid
)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  old_user public.investment_users%rowtype;
  v_temp_nickname text;
begin
  select s.account_id into v_account_id from public.site_account_sessions s
  where s.token=p_session_token and s.expires_at>now() for update;
  if v_account_id is null then raise exception '로그인 세션이 만료되었습니다.'; end if;
  if p_old_client_id is null or p_old_client_id=v_account_id
    or exists(select 1 from public.site_accounts where id=p_old_client_id) then return true; end if;
  perform 1 from public.investment_users where client_id=v_account_id for update;
  if found then return true; end if;
  select * into old_user from public.investment_users where client_id=p_old_client_id for update;
  if old_user.client_id is null then return true; end if;
  v_temp_nickname:='__link_' || substr(replace(gen_random_uuid()::text,'-',''),1,16);
  update public.investment_users set nickname=v_temp_nickname where client_id=p_old_client_id;
  insert into public.investment_users(client_id,nickname,cash,created_at)
  values(v_account_id,old_user.nickname,old_user.cash,old_user.created_at);
  update public.investment_holdings set client_id=v_account_id where client_id=p_old_client_id;
  update public.investment_shop_items set client_id=v_account_id where client_id=p_old_client_id;
  update public.investment_shop_daily_limits set client_id=v_account_id where client_id=p_old_client_id;
  update public.investment_daily_shop_rewards set client_id=v_account_id where client_id=p_old_client_id;
  update public.investment_shop_messages set client_id=v_account_id where client_id=p_old_client_id;
  update public.sanggi_backgrounds set client_id=v_account_id where client_id=p_old_client_id;
  delete from public.investment_users where client_id=p_old_client_id;
  return true;
end;
$$;
revoke all on function public.investment_link_account(uuid,uuid) from public;
grant execute on function public.investment_link_account(uuid,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
