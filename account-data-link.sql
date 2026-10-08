-- Link guest data to a site login ID only when that ID has no investment data yet.
-- Existing account data is never overwritten or merged.
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
  v_temp_nickname text;
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
     or p_old_client_id = v_account_id
     or exists (select 1 from public.site_accounts where id = p_old_client_id) then
    return true;
  end if;

  perform 1
  from public.investment_users
  where client_id = v_account_id
  for update;
  if found then
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

  v_temp_nickname := '__link_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  update public.investment_users
  set nickname = v_temp_nickname
  where client_id = p_old_client_id;

  insert into public.investment_users (client_id, nickname, cash, created_at)
  values (v_account_id, old_user.nickname, old_user.cash, old_user.created_at);

  update public.investment_holdings
  set client_id = v_account_id
  where client_id = p_old_client_id;

  update public.investment_shop_items
  set client_id = v_account_id
  where client_id = p_old_client_id;

  update public.investment_shop_daily_limits
  set client_id = v_account_id
  where client_id = p_old_client_id;

  update public.investment_daily_shop_rewards
  set client_id = v_account_id
  where client_id = p_old_client_id;

  update public.investment_shop_messages
  set client_id = v_account_id
  where client_id = p_old_client_id;

  delete from public.investment_users
  where client_id = p_old_client_id;

  return true;
end;
$$;

revoke all on function public.investment_link_account(uuid, uuid) from public;
grant execute on function public.investment_link_account(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
