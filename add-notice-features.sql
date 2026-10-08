-- 공지: 사진 + 투표 지원
alter table public.record_notices
  add column if not exists images text[] not null default '{}';

alter table public.record_polls
  alter column post_id drop not null;
alter table public.record_polls
  add column if not exists notice_id uuid unique references public.record_notices(id) on delete cascade;
alter table public.record_polls
  drop constraint if exists record_polls_owner_check;
alter table public.record_polls
  add constraint record_polls_owner_check
  check (post_id is not null or notice_id is not null);

create or replace function public.record_create_notice(
  p_admin_password text,
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
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 올바르지 않습니다.';
  end if;
  if nullif(trim(p_poll_question), '') is not null
     and (jsonb_typeof(p_poll_options) <> 'array'
       or jsonb_array_length(p_poll_options) < 2
       or jsonb_array_length(p_poll_options) > 6) then
    raise exception '투표 선택지는 2개에서 6개까지 입력해야 합니다.';
  end if;
  insert into public.record_notices(title, body)
  values (trim(p_title), trim(p_body))
  returning id into v_id;
  if nullif(trim(p_poll_question), '') is not null then
    insert into public.record_polls(notice_id, question)
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

create or replace function public.record_set_notice_images(
  p_id uuid,
  p_admin_password text,
  p_images text[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 올바르지 않습니다.';
  end if;
  if coalesce(array_length(p_images, 1), 0) > 100 then
    raise exception '이미지는 게시물당 최대 100개까지 첨부할 수 있습니다.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_images, '{}')) as img
    where img not like p_id::text || '/%'
  ) then
    raise exception '올바르지 않은 이미지 경로입니다.';
  end if;
  update public.record_notices
  set images = coalesce(p_images, '{}')
  where id = p_id;
  if not found then raise exception '공지를 찾을 수 없습니다.'; end if;
  return true;
end;
$$;

revoke all on function public.record_create_notice(text, text, text, text, jsonb) from public;
revoke all on function public.record_set_notice_images(uuid, text, text[]) from public;
grant execute on function public.record_create_notice(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.record_set_notice_images(uuid, text, text[]) to anon, authenticated;

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
               rp.created_at, rp.edited_at, rp.view_count, rp.images,
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
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from (
        select rn.id, rn.title, rn.body, rn.created_at, rn.edited_at, rn.images,
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
                 where poll.notice_id = rn.id
               ) as poll
        from public.record_notices rn
      ) n
    ), '[]'::jsonb)
  );
$$;

notify pgrst, 'reload schema';
