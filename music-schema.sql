-- Run after supabase-schema.sql in the Supabase SQL editor.
begin;

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.site_accounts(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  uploaded_by text not null,
  storage_path text not null unique,
  file_size bigint not null check (file_size between 1 and 10485760),
  mime_type text not null check (mime_type in (
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/webm', 'audio/aac'
  )),
  ready boolean not null default false,
  upload_expires_at timestamptz not null default now() + interval '1 hour',
  created_at timestamptz not null default now()
);
create index if not exists music_tracks_account_idx on public.music_tracks(account_id);

create table if not exists public.music_playlists (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.site_accounts(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create index if not exists music_playlists_account_idx on public.music_playlists(account_id);
create table if not exists public.music_playlist_tracks (
  playlist_id uuid not null references public.music_playlists(id) on delete cascade,
  track_id uuid not null references public.music_tracks(id) on delete cascade,
  position bigint generated always as identity,
  primary key (playlist_id, track_id)
);

alter table public.music_tracks enable row level security;
alter table public.music_playlists enable row level security;
alter table public.music_playlist_tracks enable row level security;
revoke all on table public.music_tracks, public.music_playlists, public.music_playlist_tracks from public, anon, authenticated;
revoke all on sequence public.music_playlist_tracks_position_seq from public, anon, authenticated;

create or replace function public.music_account(p_session_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select account_id into v_id from public.site_account_sessions
  where token = p_session_token and expires_at > now();
  if v_id is null then
    raise exception '로그인 세션이 만료되었습니다. 다시 로그인하세요.' using errcode = '28000';
  end if;
  return v_id;
end;
$$;
revoke all on function public.music_account(uuid) from public, anon, authenticated;

create or replace function public.music_library()
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'uploaded_by', uploaded_by,
    'storage_path', storage_path, 'file_size', file_size, 'created_at', created_at
  ) order by created_at, id), '[]'::jsonb) from public.music_tracks where ready;
$$;

create or replace function public.music_reserve_upload(
  p_session_token uuid, p_name text, p_file_size bigint, p_mime_type text
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.music_account(p_session_token);
  v_track public.music_tracks;
  v_username text;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 then
    raise exception '음악 이름은 1~100자로 입력하세요.';
  end if;
  if p_file_size is null or p_file_size not between 1 and 10485760 then
    raise exception '음악 파일은 10 MB 이하여야 합니다.';
  end if;
  if p_mime_type is null or p_mime_type not in (
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/webm', 'audio/aac'
  ) then raise exception '지원하지 않는 음악 파일 형식입니다.'; end if;
  -- Serialize reservations so concurrent uploads cannot exceed the account quota.
  select username into v_username from public.site_accounts where id = v_account for update;
  -- Reserve a full bucket-sized slot until Storage has confirmed the actual file size.
  if (select coalesce(sum(case when ready then file_size else 10485760 end), 0) from public.music_tracks
      where account_id = v_account and (ready or upload_expires_at > now())) + 10485760 > 104857600 then
    raise exception '계정당 음악 저장 용량은 100 MB입니다. 실패한 업로드 예약은 1시간 후 해제됩니다.';
  end if;
  insert into public.music_tracks(account_id, name, uploaded_by, storage_path, file_size, mime_type)
  values (v_account, trim(p_name), v_username, v_account::text || '/' || gen_random_uuid()::text, p_file_size, p_mime_type)
  returning * into v_track;
  return jsonb_build_object('id', v_track.id, 'storage_path', v_track.storage_path);
end;
$$;

-- The unguessable, short-lived path is an upload capability, not an account JWT.
create or replace function public.music_upload_allowed(p_path text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.music_tracks t
    where t.storage_path = p_path and not t.ready and t.upload_expires_at > now()
      and t.account_id is not null
  );
$$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('music-audio', 'music-audio', true, 10485760, array[
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/webm', 'audio/aac'
])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Music reserved uploads" on storage.objects;
create policy "Music reserved uploads" on storage.objects for insert to anon, authenticated
with check (bucket_id = 'music-audio' and public.music_upload_allowed(name));
-- Public buckets serve audio without granting listing, overwriting, or deleting files.

create or replace function public.music_finish_upload(p_session_token uuid, p_track_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare
  v_account uuid := public.music_account(p_session_token);
  v_track public.music_tracks;
  v_metadata jsonb;
begin
  select * into v_track from public.music_tracks
  where id = p_track_id and account_id = v_account for update;
  if v_track.id is null then raise exception '내 업로드를 찾을 수 없습니다.'; end if;
  if v_track.ready then return true; end if;
  if v_track.upload_expires_at <= now() then raise exception '업로드 예약이 만료되었습니다. 다시 올려 주세요.'; end if;
  select metadata into v_metadata from storage.objects
  where bucket_id = 'music-audio' and name = v_track.storage_path;
  if v_metadata is null
    or (v_metadata->>'size')::bigint is distinct from v_track.file_size
    or (v_metadata->>'mimetype') is distinct from v_track.mime_type then
    raise exception '업로드된 파일 크기와 형식을 확인할 수 없습니다.';
  end if;
  update public.music_tracks set ready = true where id = v_track.id;
  return true;
end;
$$;

create or replace function public.music_playlist_json(p_playlist_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'track_ids', coalesce((
    select jsonb_agg(t.track_id order by t.position)
    from public.music_playlist_tracks t where t.playlist_id = p.id
  ), '[]'::jsonb)) from public.music_playlists p where p.id = p_playlist_id;
$$;
revoke all on function public.music_playlist_json(uuid) from public, anon, authenticated;

create or replace function public.music_my_playlists(p_session_token uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.music_account(p_session_token);
begin
  return (select coalesce(jsonb_agg(public.music_playlist_json(id) order by created_at, id), '[]'::jsonb)
    from public.music_playlists where account_id = v_account);
end;
$$;

create or replace function public.music_create_playlist(p_session_token uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.music_account(p_session_token); v_id uuid;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 then
    raise exception '재생목록 이름은 1~100자로 입력하세요.';
  end if;
  perform 1 from public.site_accounts where id = v_account for update;
  if (select count(*) from public.music_playlists where account_id = v_account) >= 100 then
    raise exception '재생목록은 계정당 100개까지 만들 수 있습니다.';
  end if;
  insert into public.music_playlists(account_id, name) values (v_account, trim(p_name)) returning id into v_id;
  return public.music_playlist_json(v_id);
end;
$$;

create or replace function public.music_playlist_track(
  p_session_token uuid, p_playlist_id uuid, p_track_id uuid, p_remove boolean
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.music_account(p_session_token);
begin
  perform 1 from public.music_playlists where id = p_playlist_id and account_id = v_account for update;
  if not found then raise exception '내 재생목록을 찾을 수 없습니다.'; end if;
  if p_remove is null then raise exception '재생목록 작업을 지정하세요.'; end if;
  if p_remove then
    delete from public.music_playlist_tracks where playlist_id = p_playlist_id and track_id = p_track_id;
  else
    if not exists (select 1 from public.music_tracks where id = p_track_id and ready) then
      raise exception '음악을 찾을 수 없습니다.';
    end if;
    insert into public.music_playlist_tracks(playlist_id, track_id)
    values (p_playlist_id, p_track_id) on conflict do nothing;
  end if;
  return public.music_playlist_json(p_playlist_id);
end;
$$;

create or replace function public.music_delete_playlist(p_session_token uuid, p_playlist_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_account uuid := public.music_account(p_session_token);
begin
  delete from public.music_playlists where id = p_playlist_id and account_id = v_account;
  if not found then raise exception '내 재생목록을 찾을 수 없습니다.'; end if;
  return true;
end;
$$;

revoke all on function public.music_library() from public;
revoke all on function public.music_reserve_upload(uuid, text, bigint, text) from public;
revoke all on function public.music_upload_allowed(text) from public;
revoke all on function public.music_finish_upload(uuid, uuid) from public;
revoke all on function public.music_my_playlists(uuid) from public;
revoke all on function public.music_create_playlist(uuid, text) from public;
revoke all on function public.music_playlist_track(uuid, uuid, uuid, boolean) from public;
revoke all on function public.music_delete_playlist(uuid, uuid) from public;
grant execute on function public.music_library() to anon, authenticated;
grant execute on function public.music_reserve_upload(uuid, text, bigint, text) to anon, authenticated;
grant execute on function public.music_upload_allowed(text) to anon, authenticated;
grant execute on function public.music_finish_upload(uuid, uuid) to anon, authenticated;
grant execute on function public.music_my_playlists(uuid) to anon, authenticated;
grant execute on function public.music_create_playlist(uuid, text) to anon, authenticated;
grant execute on function public.music_playlist_track(uuid, uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.music_delete_playlist(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
