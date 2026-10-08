-- 게시물 이미지 (Storage 버킷 + 이미지 경로 컬럼)
alter table public.record_posts
  add column if not exists images text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('record-images', 'record-images', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = 1048576,
      allowed_mime_types = array['image/webp', 'image/jpeg'];

drop policy if exists "record images insert" on storage.objects;
create policy "record images insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'record-images');

drop policy if exists "record images select" on storage.objects;
create policy "record images select" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'record-images');

drop policy if exists "record images delete" on storage.objects;
create policy "record images delete" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'record-images');

create or replace function public.record_set_post_images(
  p_id uuid,
  p_password_hash text,
  p_images text[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(array_length(p_images, 1), 0) > 100 then
    raise exception '이미지는 게시물당 최대 100개까지 첨부할 수 있습니다.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_images, '{}')) as img
    where img not like p_id::text || '/%'
  ) then
    raise exception '올바르지 않은 이미지 경로입니다.';
  end if;
  update public.record_posts
  set images = coalesce(p_images, '{}')
  where id = p_id and password_hash = p_password_hash;
  if not found then raise exception '게시물 비밀번호가 올바르지 않습니다.'; end if;
  return true;
end;
$$;

revoke all on function public.record_set_post_images(uuid, text, text[]) from public;
grant execute on function public.record_set_post_images(uuid, text, text[]) to anon, authenticated;

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
      select jsonb_agg(to_jsonb(rn) order by rn.created_at desc)
      from public.record_notices rn
    ), '[]'::jsonb)
  );
$$;

notify pgrst, 'reload schema';
