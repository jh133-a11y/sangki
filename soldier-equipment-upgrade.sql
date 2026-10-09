begin;
create table if not exists public.soldier_equipment (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  weapon text not null,
  grade text not null default 'D' check (grade in ('D','C','B','A','S')),
  level integer not null default 1 check (level between 1 and 7),
  primary key (client_id,weapon)
);
alter table public.soldier_equipment enable row level security;
revoke all on public.soldier_equipment from anon,authenticated;

create or replace function public.soldier_equipment_api(p_token uuid,p_weapon text default null,p_level integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sess public.soldier_sessions%rowtype;
  item public.soldier_equipment%rowtype;
  balance bigint; cost bigint; base bigint; increment bigint;
begin
  select * into sess from public.soldier_sessions where token=p_token and expires_at>clock_timestamp();
  if sess.token is null then raise exception '솔져 세션이 만료되었습니다. 새로고침하세요.'; end if;
  if sess.account_token is not null then
    if not exists(select 1 from public.site_account_sessions where token=sess.account_token and account_id=sess.client_id and expires_at>clock_timestamp()) then raise exception '다시 로그인하세요.'; end if;
  elsif exists(select 1 from public.site_accounts where id=sess.client_id) then raise exception '투자 정보가 계정에 연결되었습니다. 로그인 후 다시 접속하세요.'; end if;
  select gold into balance from public.soldier_profiles where client_id=sess.client_id for update;
  if not found then raise exception '솔져 프로필이 없습니다.'; end if;
  if p_weapon is not null then
    if public.soldier_weapon(p_weapon) is null then raise exception '무기가 올바르지 않습니다.'; end if;
    if p_level is null or p_level not between 1 and 6 then raise exception '강화 레벨이 올바르지 않습니다.'; end if;
    insert into public.soldier_equipment(client_id,weapon) values(sess.client_id,p_weapon) on conflict do nothing;
    select * into item from public.soldier_equipment where client_id=sess.client_id and weapon=p_weapon for update;
    if item.level<>p_level then raise exception '무기 레벨이 변경되었습니다. 장비를 새로 불러오세요.'; end if;
    base:=case item.grade when 'D' then 1000 when 'C' then 3000 when 'B' then 5000 when 'A' then 10000 when 'S' then 20000 end;
    increment:=case item.grade when 'D' then 1000 when 'C' then 1000 when 'B' then 2000 when 'A' then 5000 when 'S' then 10000 end;
    cost:=base+(item.level-1)*increment;
    if balance<cost then raise exception '솔져 골드가 부족합니다. 필요한 골드: %',cost; end if;
    update public.soldier_profiles set gold=gold-cost where client_id=sess.client_id;
    update public.soldier_equipment set level=level+1 where client_id=sess.client_id and weapon=p_weapon;
    balance:=balance-cost;
  elsif p_level is not null then raise exception '무기가 필요합니다.';
  end if;
  return jsonb_build_object('gold',balance::text,'equipment',coalesce((
    select jsonb_object_agg(weapon,jsonb_build_object('grade',grade,'level',level))
    from public.soldier_equipment where client_id=sess.client_id
  ),'{}'::jsonb));
end $$;
revoke all on function public.soldier_equipment_api(uuid,text,integer) from public;
grant execute on function public.soldier_equipment_api(uuid,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
