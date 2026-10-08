-- 공지: 추천/비추천/댓글/답글
alter table public.record_notices
  add column if not exists upvotes bigint not null default 0,
  add column if not exists downvotes bigint not null default 0;

create table if not exists public.record_notice_votes (
  notice_id uuid not null references public.record_notices(id) on delete cascade,
  voter_key text not null check (char_length(voter_key) between 16 and 128),
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (notice_id, voter_key)
);
alter table public.record_notice_votes enable row level security;

alter table public.record_comments alter column post_id drop not null;
alter table public.record_comments
  add column if not exists notice_id uuid references public.record_notices(id) on delete cascade;
alter table public.record_comments drop constraint if exists record_comments_owner_check;
alter table public.record_comments
  add constraint record_comments_owner_check check (post_id is not null or notice_id is not null);

create or replace function public.record_get_notice_comments(p_notice_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at asc), '[]'::jsonb)
  from (
    select id, notice_id, parent_id, nickname, body, created_at, edited_at
    from public.record_comments
    where notice_id = p_notice_id
  ) c;
$$;

create or replace function public.record_create_notice_comment(
  p_notice_id uuid,
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
  if not exists (select 1 from public.record_notices where id = p_notice_id) then raise exception '공지를 찾을 수 없습니다.'; end if;
  if p_parent_id is not null and not exists (
    select 1 from public.record_comments where id = p_parent_id and notice_id = p_notice_id
  ) then raise exception '답글 대상을 찾을 수 없습니다.'; end if;
  insert into public.record_comments(notice_id, parent_id, nickname, password_hash, body)
  values (p_notice_id, p_parent_id, trim(p_nickname), p_password_hash, trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.record_vote_notice(
  p_notice_id uuid,
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
  insert into public.record_notice_votes(notice_id, voter_key, vote)
  values (p_notice_id, p_voter_key, p_vote)
  on conflict (notice_id, voter_key) do update set vote = excluded.vote;
  select count(*) filter (where vote = 1), count(*) filter (where vote = -1)
  into v_upvotes, v_downvotes
  from public.record_notice_votes where notice_id = p_notice_id;
  update public.record_notices set upvotes = v_upvotes, downvotes = v_downvotes where id = p_notice_id;
  return jsonb_build_object('upvotes', v_upvotes, 'downvotes', v_downvotes);
end;
$$;

revoke all on function public.record_get_notice_comments(uuid) from public;
revoke all on function public.record_create_notice_comment(uuid, uuid, text, text, text) from public;
revoke all on function public.record_vote_notice(uuid, text, smallint) from public;
grant execute on function public.record_get_notice_comments(uuid) to anon, authenticated;
grant execute on function public.record_create_notice_comment(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.record_vote_notice(uuid, text, smallint) to anon, authenticated;

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
               rn.upvotes, rn.downvotes,
               (select count(*) from public.record_comments rc where rc.notice_id = rn.id) as comment_count,
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
