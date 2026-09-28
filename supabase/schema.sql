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

create index if not exists comments_work_idx on public.comments (work_id, created_at);

-- ------------------------------------------------------------
-- 6. ハート／閲覧
--    visitor_id は、見に来た人のブラウザが持つランダムなIDです。
--    誰かは分かりません（同じ人が連打しても1回に数えるためだけのもの）。
-- ------------------------------------------------------------
create table if not exists public.hearts (
  work_id    text not null references public.works(id) on delete cascade,
  visitor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (work_id, visitor_id)
);

create table if not exists public.work_views (
  work_id    text not null references public.works(id) on delete cascade,
  visitor_id uuid not null,
  viewed_on  date not null default current_date,
  primary key (work_id, visitor_id, viewed_on)
);

-- ------------------------------------------------------------
-- 7. 数の集計（閲覧数・ハート数・コメント数）
-- ------------------------------------------------------------
create or replace view public.work_stats
with (security_invoker = on) as
select
  w.id                                     as work_id,
  w.base_views  + coalesce(v.n, 0)::int    as views,
  w.base_hearts + coalesce(h.n, 0)::int    as hearts,
  coalesce(c.n, 0)::int                    as comments
from public.works w
left join (select work_id, count(*) n from public.work_views group by work_id) v on v.work_id = w.id
left join (select work_id, count(*) n from public.hearts     group by work_id) h on h.work_id = w.id
left join (select work_id, count(*) n from public.comments   group by work_id) c on c.work_id = w.id;

-- ------------------------------------------------------------
-- 8. ハートの ON/OFF と 閲覧の記録
--    直接 insert / delete させず、この関数経由だけにしています。
--    （他人のハートを消せないようにするため）
-- ------------------------------------------------------------
create or replace function public.toggle_heart(p_work_id text, p_visitor uuid)
returns boolean                       -- true = 押した状態になった
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.hearts where work_id = p_work_id and visitor_id = p_visitor;
  if found then
    return false;
  end if;
  insert into public.hearts (work_id, visitor_id) values (p_work_id, p_visitor);
  return true;
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
drop policy if exists "views read"          on public.work_views;

-- 自分が投稿者かどうかだけ確認できる
create policy "admins self read" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- 見るのは誰でもOK
create policy "settings read"  on public.site_settings for select using (true);
create policy "works read"     on public.works         for select using (true);
create policy "posts read"     on public.blog_posts    for select using (true);
create policy "comments read"  on public.comments      for select using (true);
create policy "hearts read"    on public.hearts        for select using (true);
create policy "views read"     on public.work_views    for select using (true);

-- 書き換えられるのは admins に載っている人だけ
create policy "settings admin write" on public.site_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "works admin write" on public.works
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "posts admin write" on public.blog_posts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- コメントの書き込み。
-- 管理ページで「Googleログインを必須にする」をONにすると、
-- ログインしていない人の書き込みをサーバー側で弾きます。
create policy "comments insert" on public.comments for insert
  with check (
    auth.uid() is not null
    or coalesce((select s.require_login_to_comment from public.site_settings s where s.id = 1), false) = false
  );

-- 消せるのは投稿者だけ
create policy "comments admin del" on public.comments for delete to authenticated using (public.is_admin());

-- hearts / work_views には insert・delete のルールを作りません。
-- ＝ 直接は書き込めず、上の toggle_heart / register_view 経由だけになります。

-- ------------------------------------------------------------
--  権限まわり
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.works, public.blog_posts, public.site_settings,
                public.comments, public.hearts, public.work_views,
                public.work_stats
  to anon, authenticated;

grant insert on public.comments to anon, authenticated;
grant insert, update, delete on public.works, public.blog_posts to authenticated;
grant update on public.site_settings to authenticated;
grant delete on public.comments      to authenticated;
grant select on public.admins        to authenticated;

grant execute on function public.toggle_heart(text, uuid)  to anon, authenticated;
grant execute on function public.register_view(text, uuid) to anon, authenticated;
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
