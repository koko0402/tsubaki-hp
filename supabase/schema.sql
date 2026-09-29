-- ============================================================
--  椿@お絵描き局  —  Supabase のデータ設計
--  ------------------------------------------------------------
--  Supabase の SQL Editor に、このファイルをまるごと貼って実行。
--  何度実行しても壊れないように書いてあります。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 投稿できる人（あなたと椿さん）
--    ここに user_id が載っている人だけが書き込めます。
-- ------------------------------------------------------------
create table if not exists public.admins (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  artist_key   text not null,               -- works.artist と対応（tsubaki / kanri など）
  created_at   timestamptz not null default now()
);

-- 「今ログインしている人は投稿者か？」を判定する関数。
-- security definer なので、この関数の中だけは admins を無条件に読めます。
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- 「今ログインしている人は、いいね・コメントしてよい人か？」
--   Google でログインした人と、投稿者（admins）だけ。
--   Google ログインのために新規登録をオンにすると、メール＋合言葉での登録も
--   開いてしまう。捨てアドレスで大量に作られても書き込めないように、ここで絞る。
create or replace function public.can_interact()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_admin()
    or coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google'
    or coalesce(auth.jwt()->'app_metadata'->'providers', '[]'::jsonb) ? 'google'
  );
$$;

-- ------------------------------------------------------------
-- 2. サイト設定（1行だけ持つテーブル）
-- ------------------------------------------------------------
create table if not exists public.site_settings (
  id              int primary key default 1 check (id = 1),
  title           text not null default '椿@お絵描き局',
  tagline         text not null default '絵を展示する場所',
  links           jsonb not null default '[]'::jsonb,
  artists         jsonb not null default
                    '{"tsubaki":{"name":"椿","color":"#c62b3d","icon":"camellia"},
                      "kanri":{"name":"管理人","color":"#3f6b46","icon":"leaf"}}'::jsonb,
  pickup_message  text not null default '',
  youtube_id      text not null default '',
  youtube_title   text not null default 'メイキング動画',
  updated_at      timestamptz not null default now()
);

-- コメントに Google ログインを必須にするか（管理ページから切り替えられます）
alter table public.site_settings
  add column if not exists require_login_to_comment boolean not null default false;

-- 背景の絵（管理ページ → サイト設定 → 背景の絵）
--   bg_image が空なら、木目の背景のままになります。
--   bg_mode は 'cover'（全面に伸ばす）か 'tile'（並べて敷き詰める）。
--   bg_dim は背景を暗くする度合い 0〜0.7。明るい絵で文字が読みにくいときに上げます。
-- 見た目（色・角丸・影・フォント・幅）／ページの出し分け／自分で足すCSS
alter table public.site_settings
  add column if not exists theme      jsonb not null default '{}'::jsonb;
alter table public.site_settings
  add column if not exists sections   jsonb not null default '{}'::jsonb;
alter table public.site_settings
  add column if not exists custom_css text  not null default '';

alter table public.site_settings
  add column if not exists bg_image text not null default '';
alter table public.site_settings
  add column if not exists bg_mode  text not null default 'cover';
alter table public.site_settings
  add column if not exists bg_dim   real not null default 0.25;

insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3. 作品
-- ------------------------------------------------------------
create table if not exists public.works (
  id           text primary key,
  title        text not null,
  image_path   text not null,                 -- ストレージ内のパス（http… なら外部URLとして扱う）
  artist       text not null default 'tsubaki',
  posted_on    date not null default current_date,
  description  text not null default '',
  tags         text[] not null default '{}',
  base_views   int  not null default 0,       -- 開設前の数字を持たせたい時だけ
  base_hearts  int  not null default 0,
  is_pickup    boolean not null default false,
  pickup_order int,
  created_at   timestamptz not null default now()
);

-- 1投稿に複数枚の絵。空なら image_path の1枚だけ
-- （works を作ったあとでないと足せないので、ここに置く）
alter table public.works
  add column if not exists image_paths text[] not null default '{}';

create index if not exists works_posted_on_idx on public.works (posted_on desc);

-- ------------------------------------------------------------
-- 4. ブログ
-- ------------------------------------------------------------
create table if not exists public.blog_posts (
  id         uuid primary key default gen_random_uuid(),
  posted_on  date not null default current_date,
  title      text not null,
  body       text not null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. コメント（だれでも書ける）
-- ------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  work_id    text not null references public.works(id) on delete cascade,
  name       text not null default 'ななし',
  body       text not null,
  created_at timestamptz not null default now(),
  constraint comments_length check (
    char_length(body) between 1 and 400 and char_length(name) <= 20
  )
);

-- 書いた人のアイコン（プロフィール）
alter table public.comments
  add column if not exists avatar_icon  text,
  add column if not exists avatar_color text,
  add column if not exists avatar_url   text,
  add column if not exists visitor_id   uuid,
  add column if not exists user_id      uuid references auth.users(id) on delete set null;

-- 返信（コメントにぶら下がるコメント）
-- parent_id が空なら、それはいちばん上のコメント。
-- 入っていれば、そのコメントへの返信。親を消すと返信もまとめて消えます。
alter table public.comments
  add column if not exists parent_id uuid references public.comments(id) on delete cascade;

create index if not exists comments_work_idx   on public.comments (work_id, created_at);
create index if not exists comments_parent_idx on public.comments (parent_id);
create index if not exists comments_user_idx   on public.comments (user_id, created_at);

-- アイコンに入れてよい値だけに絞る。
-- 画面側で変な値を弾いていても、APIを直接叩かれたら素通りするので、ここでも止める。
alter table public.comments drop constraint if exists comments_avatar_ok;
alter table public.comments add constraint comments_avatar_ok check (
  (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$')
  and (avatar_icon is null or avatar_icon in
       ('camellia','star','moon','cat','leaf','drop','note','heart'))
  and (avatar_url is null or avatar_url like 'https://lh3.googleusercontent.com/%')
);

-- ------------------------------------------------------------
-- 5.5 スタンプ（見に来た人が描いて、コメントで使う絵）
--    ・作れるのはログインした人（can_interact）だけ。create_stamp() 経由でしか作れない
--    ・中身は小さい画像（PNG か WebP）を data URL の文字列で持つ
--    ・1人30個まで、1人1日20個まで、サイト全体で3000個まで
--      （1個あたり最大6万文字 ≒ 45KB なので、全部埋まっても 180MB ほど。無料枠の DB 500MB に収まる）
--    ・消せるのは作った本人と投稿者（admins）
-- ------------------------------------------------------------
create table if not exists public.stamps (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       text not null,
  created_at timestamptz not null default now(),
  constraint stamps_data_ok check (
    char_length(data) <= 60000
    and data ~ '^data:image/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  )
);
create index if not exists stamps_user_idx on public.stamps (user_id, created_at);

-- コメントに付けるスタンプ（1件に1つ）。スタンプが消されたら、コメントからも外れる
alter table public.comments
  add column if not exists stamp_id uuid references public.stamps(id) on delete set null;

-- スタンプだけのコメント（本文が空）も書けるようにする。
-- 「文字かスタンプのどちらかは要る」は create_comment() で確かめる。
-- （ここで縛ると、スタンプが消されて stamp_id が空になったときに消せなくなるので）
alter table public.comments drop constraint if exists comments_length;
alter table public.comments add constraint comments_length check (
  char_length(body) <= 400 and char_length(name) <= 20
);

-- ------------------------------------------------------------
-- 6. ハート／閲覧
--    ハートはログインした人だけが押せる。1人1作品に1つ。
--    閲覧数はログインしていなくても数える。visitor_id はブラウザが持つ
--    ランダムなIDで、同じ人が何度開いても1日1回に数えるためだけのもの。
-- ------------------------------------------------------------

-- 古い作り（visitor_id で数えていた頃）の hearts が残っていたら作り直す。
-- 公開前の試しのデータしか入っていないはずなので、中身は捨てる。
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'hearts' and column_name = 'visitor_id') then
    drop table public.hearts cascade;
  end if;
end $$;

create table if not exists public.hearts (
  work_id    text not null references public.works(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (work_id, user_id)
);

create table if not exists public.work_views (
  work_id    text not null references public.works(id) on delete cascade,
  visitor_id uuid not null,
  viewed_on  date not null default current_date,
  primary key (work_id, visitor_id, viewed_on)
);

-- ------------------------------------------------------------
-- 7. 数の集計（閲覧数・ハート数・コメント数）
--    hearts と work_views は、中身（誰が押したか）を外から読めないようにしてある。
--    数だけはこの関数で返す。security definer なので、関数の中だけは全部数えられる。
-- ------------------------------------------------------------
drop view if exists public.work_stats;

create or replace function public.work_stats()
returns table (work_id text, views int, hearts int, comments int)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id,
    w.base_views  + coalesce(v.n, 0)::int,
    w.base_hearts + coalesce(h.n, 0)::int,
    coalesce(c.n, 0)::int
  from public.works w
  left join (select work_id, count(*) n from public.work_views group by work_id) v on v.work_id = w.id
  left join (select work_id, count(*) n from public.hearts     group by work_id) h on h.work_id = w.id
  left join (select work_id, count(*) n from public.comments   group by work_id) c on c.work_id = w.id;
$$;

-- ------------------------------------------------------------
-- 8. ハートの ON/OFF と 閲覧の記録
--    直接 insert / delete させず、この関数経由だけにしています。
--    ハートは「今ログインしている人」の分しか動かせません。
-- ------------------------------------------------------------
drop function if exists public.toggle_heart(text, uuid);

create or replace function public.toggle_heart(p_work_id text)
returns boolean                       -- true = 押した状態になった
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if not public.can_interact() then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  delete from public.hearts where work_id = p_work_id and user_id = uid;
  if found then
    return false;
  end if;
  insert into public.hearts (work_id, user_id) values (p_work_id, uid);
  return true;
end;
$$;

-- ------------------------------------------------------------
-- 8.5 コメントを書く
--    直接 insert はさせず、この関数経由だけ。
--    書いた人（user_id）と日時は、ここでサーバーが決める。送られてきた値は使わない。
--    ・ログインしていないと書けない
--    ・返信の親は、同じ作品のコメントだけ
--    ・連投の上限：1分に5件、1日に100件（1人あたり）
--    ・文字かスタンプのどちらかは要る（スタンプだけのコメントもOK）
-- ------------------------------------------------------------
drop function if exists public.create_comment(text, uuid, text, text, text, text, boolean);
drop function if exists public.create_comment(text, uuid, text, text, text, text, boolean, uuid);

create or replace function public.create_comment(
  p_work_id   text,
  p_parent_id uuid,
  p_body      text,
  p_name      text,
  p_icon      text,
  p_color     text,
  p_use_photo boolean,
  p_stamp_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  body   text := btrim(coalesce(p_body, ''));
  nm     text := btrim(coalesce(p_name, ''));
  photo  text;
  new_id uuid;
begin
  if not public.can_interact() then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  if char_length(body) > 400 then
    raise exception 'コメントは400文字までです';
  end if;
  if char_length(body) = 0 and p_stamp_id is null then
    raise exception 'コメントを書くか、スタンプを選んでください';
  end if;
  if p_stamp_id is not null and not exists (select 1 from public.stamps where id = p_stamp_id) then
    raise exception 'そのスタンプは見つかりません';
  end if;
  if char_length(nm) not between 1 and 20 then
    raise exception 'なまえは1〜20文字にしてください';
  end if;
  if not exists (select 1 from public.works where id = p_work_id) then
    raise exception 'その作品は見つかりません';
  end if;
  if p_parent_id is not null and not exists (
       select 1 from public.comments where id = p_parent_id and work_id = p_work_id) then
    raise exception '返信先のコメントが見つかりません';
  end if;

  if (select count(*) from public.comments
      where user_id = uid and created_at > now() - interval '1 minute') >= 5 then
    raise exception '少し時間をおいてから書いてください';
  end if;
  if (select count(*) from public.comments
      where user_id = uid and created_at > now() - interval '1 day') >= 100 then
    raise exception '今日はもう書き込めません';
  end if;

  -- Google の写真を使うときは、送られてきたURLではなく、ログイン情報から取る
  if p_use_photo then
    select coalesce(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture')
      into photo from auth.users where id = uid;
    if photo is null or photo not like 'https://lh3.googleusercontent.com/%' then
      photo := null;
    end if;
  end if;

  insert into public.comments
    (work_id, parent_id, name, body, avatar_icon, avatar_color, avatar_url, user_id, stamp_id)
  values
    (p_work_id, p_parent_id, nm, body,
     case when photo is null then p_icon  end,
     case when photo is null then p_color end,
     photo, uid, p_stamp_id)
  returning id into new_id;

  return new_id;
end;
$$;

-- ------------------------------------------------------------
-- 8.6 スタンプを作る・消す
-- ------------------------------------------------------------
create or replace function public.create_stamp(p_data text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  new_id uuid;
begin
  if not public.can_interact() then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  if p_data is null or char_length(p_data) > 60000 then
    raise exception 'スタンプの絵が大きすぎます';
  end if;
  if p_data !~ '^data:image/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'スタンプの形式がちがいます';
  end if;
  if (select count(*) from public.stamps where user_id = uid) >= 30 then
    raise exception 'スタンプは30個までです。いらないものを消してから作ってください';
  end if;
  if (select count(*) from public.stamps
      where user_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception '今日はもうスタンプを作れません';
  end if;
  if (select count(*) from public.stamps) >= 3000 then
    raise exception 'サイト全体のスタンプがいっぱいです';
  end if;

  insert into public.stamps (user_id, data) values (uid, p_data)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.delete_stamp(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です' using errcode = '28000';
  end if;
  delete from public.stamps
   where id = p_id and (user_id = auth.uid() or public.is_admin());
  if not found then
    raise exception 'そのスタンプは消せません';
  end if;
end;
$$;

create or replace function public.register_view(p_work_id text, p_visitor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.work_views (work_id, visitor_id) values (p_work_id, p_visitor)
  on conflict do nothing;
end;
$$;

-- ============================================================
--  ここから「誰が何をできるか」の設定（いちばん大事なところ）
-- ============================================================

alter table public.admins        enable row level security;
alter table public.site_settings enable row level security;
alter table public.works         enable row level security;
alter table public.blog_posts    enable row level security;
alter table public.comments      enable row level security;
alter table public.hearts        enable row level security;
alter table public.work_views    enable row level security;
alter table public.stamps        enable row level security;

-- 同じ名前のルールが残っていると作り直せないので、先に消す
drop policy if exists "admins self read"    on public.admins;
drop policy if exists "settings read"       on public.site_settings;
drop policy if exists "settings admin write" on public.site_settings;
drop policy if exists "works read"          on public.works;
drop policy if exists "works admin write"   on public.works;
drop policy if exists "posts read"          on public.blog_posts;
drop policy if exists "posts admin write"   on public.blog_posts;
drop policy if exists "comments read"       on public.comments;
drop policy if exists "comments insert"     on public.comments;
drop policy if exists "comments admin del"  on public.comments;
drop policy if exists "hearts read"         on public.hearts;
drop policy if exists "hearts own read"     on public.hearts;
drop policy if exists "views read"          on public.work_views;
drop policy if exists "stamps read"         on public.stamps;

-- 自分が投稿者かどうかだけ確認できる
create policy "admins self read" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- 見るのは誰でもOK
create policy "settings read"  on public.site_settings for select using (true);
create policy "works read"     on public.works         for select using (true);
create policy "posts read"     on public.blog_posts    for select using (true);
create policy "comments read"  on public.comments      for select using (true);

-- ハートは「自分が押したもの」だけ見える（誰が押したかは他の人に見せない）
create policy "hearts own read" on public.hearts
  for select to authenticated using (user_id = auth.uid());
-- work_views は誰も直接は読めない（数は work_stats() で返す）

-- スタンプは誰でも見られる（コメントに付いているものを表示するため）。
-- 作る・消すのは create_stamp() / delete_stamp() 経由だけ
create policy "stamps read" on public.stamps for select using (true);

-- 書き換えられるのは admins に載っている人だけ
create policy "settings admin write" on public.site_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "works admin write" on public.works
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "posts admin write" on public.blog_posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- コメントの書き込みは create_comment() 経由だけ。直接 insert のルールは作らない。

-- 消せるのは投稿者だけ
create policy "comments admin del" on public.comments for delete to authenticated using (public.is_admin());

-- hearts / work_views には insert・delete のルールを作りません。
-- ＝ 直接は書き込めず、上の toggle_heart / register_view 経由だけになります。

-- ------------------------------------------------------------
--  権限まわり
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.works, public.blog_posts, public.site_settings, public.comments
  to anon, authenticated;

-- 前の作りで配っていた権限を取り上げる（何度流しても同じ結果になるように）
revoke insert, update, delete on public.comments   from anon, authenticated;
revoke all                    on public.hearts     from anon, authenticated;
revoke all                    on public.work_views from anon, authenticated;
revoke all                    on public.stamps     from anon, authenticated;
grant select (id, user_id, data, created_at) on public.stamps to anon, authenticated;

grant select on public.hearts        to authenticated;   -- 見えるのは自分の分だけ（上のルール）
grant insert, update, delete on public.works, public.blog_posts to authenticated;
grant update on public.site_settings to authenticated;
grant delete on public.comments      to authenticated;   -- 実際に消せるのは投稿者だけ（上のルール）
grant select on public.admins        to authenticated;

-- 関数は、書いた人以外が勝手に呼べないよう一度閉じてから、必要な相手にだけ開ける
revoke execute on function public.toggle_heart(text)  from public;
revoke execute on function public.create_comment(text, uuid, text, text, text, text, boolean, uuid) from public;
revoke execute on function public.create_stamp(text) from public;
revoke execute on function public.delete_stamp(uuid) from public;
revoke execute on function public.register_view(text, uuid) from public;
revoke execute on function public.work_stats() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.can_interact() from public;

grant execute on function public.work_stats()               to anon, authenticated;
grant execute on function public.register_view(text, uuid)  to anon, authenticated;
grant execute on function public.toggle_heart(text)         to authenticated;
grant execute on function public.create_comment(text, uuid, text, text, text, text, boolean, uuid) to authenticated;
grant execute on function public.create_stamp(text) to authenticated;
grant execute on function public.delete_stamp(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------
-- 9. 画像置き場（ストレージ）
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('art', 'art', true)
on conflict (id) do update set public = true;

drop policy if exists "art public read"  on storage.objects;
drop policy if exists "art admin upload" on storage.objects;
drop policy if exists "art admin delete" on storage.objects;

create policy "art public read" on storage.objects
  for select using (bucket_id = 'art');

create policy "art admin upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'art' and public.is_admin());

create policy "art admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'art' and public.is_admin());

-- ============================================================
--  最後に：自分を「投稿者」として登録する
--  ------------------------------------------------------------
--  先に Authentication > Users で自分と椿さんのアカウントを作ってから、
--  下の2行のコメントを外して、メールアドレスを書き換えて実行してください。
-- ============================================================

-- insert into public.admins (user_id, display_name, artist_key)
-- select id, '管理人', 'kanri' from auth.users where email = 'あなたのメール@example.com'
-- on conflict (user_id) do nothing;

-- insert into public.admins (user_id, display_name, artist_key)
-- select id, '椿', 'tsubaki' from auth.users where email = '椿さんのメール@example.com'
-- on conflict (user_id) do nothing;
