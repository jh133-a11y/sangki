begin;
create table if not exists public.soldier_characters (
  client_id uuid not null references public.soldier_profiles(client_id) on delete cascade,
  character text not null check (character in ('fsb-agent','roka-swc')),
  level integer not null default 1 check (level between 1 and 7),
  primary key (client_id,character)
);
alter table public.soldier_characters enable row level security;
revoke all on public.soldier_characters from anon,authenticated;
alter table public.soldier_profiles add column if not exists equipped_character text not null default 'black-water'
  check (equipped_character in ('black-water','fsb-agent','roka-swc'));

create or replace function public.soldier_shop_api(p_token uuid,p_action text default 'read',p_character text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  sess public.soldier_sessions%rowtype;
  profile public.soldier_profiles%rowtype;
begin
  -- Reuse the authoritative session/account verification.
  perform public.soldier_equipment_api(p_token);
  select * into sess from public.soldier_sessions where token=p_token;
  select * into profile from public.soldier_profiles where client_id=sess.client_id for update;
  if p_action is null or p_action not in ('read','buy','equip') then raise exception '상점 요청이 올바르지 않습니다.'; end if;
  if p_action in ('buy','equip') then
    if p_character is null or p_character not in ('black-water','fsb-agent','roka-swc') then raise exception '캐릭터가 올바르지 않습니다.'; end if;
    if p_action='buy' then
      if p_character='black-water' then raise exception '기본 캐릭터는 구매할 필요가 없습니다.'; end if;
      if exists(select 1 from public.soldier_characters where client_id=sess.client_id and character=p_character) then raise exception '이미 보유한 캐릭터입니다.'; end if;
      if (select count(*) from public.soldier_characters where client_id=sess.client_id)>=50 then raise exception '캐릭터 인벤토리는 최대 50개입니다.'; end if;
      if profile.gems<125 then raise exception '보석이 부족합니다. 필요한 보석: 125'; end if;
      insert into public.soldier_characters(client_id,character) values(sess.client_id,p_character);
      update public.soldier_profiles set gems=gems-125 where client_id=sess.client_id;
    else
      if p_character<>'black-water' and not exists(select 1 from public.soldier_characters where client_id=sess.client_id and character=p_character) then raise exception '보유하지 않은 캐릭터입니다.'; end if;
      update public.soldier_profiles set equipped_character=p_character where client_id=sess.client_id;
    end if;
  end if;
  select * into profile from public.soldier_profiles where client_id=sess.client_id;
  return jsonb_build_object('gold',profile.gold::text,'gems',profile.gems::text,
    'equipped',profile.equipped_character,'characters',coalesce((
      select jsonb_object_agg(character,jsonb_build_object('level',level)) from public.soldier_characters where client_id=sess.client_id
    ),'{}'::jsonb));
end $$;
revoke all on function public.soldier_shop_api(uuid,text,text) from public;
grant execute on function public.soldier_shop_api(uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
