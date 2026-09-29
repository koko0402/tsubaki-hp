"""schema.sql を本物の PostgreSQL に流して、権限まわりを実際に叩いて確かめる。
Supabase 固有のもの（auth スキーマ、anon/authenticated ロール、storage）は最小限の模造品を作る。"""
import sys, pgserver, psycopg

SCHEMA = sys.argv[1]
import tempfile, os
srv = pgserver.get_server(os.path.join(tempfile.gettempdir(), 'tsubaki_pgdata'), cleanup_mode='stop')
uri = srv.get_uri()

SHIM = """
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; drop schema if exists storage cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
grant execute on function auth.jwt() to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
-- Supabase は public の新しいテーブルに anon/authenticated へ全部の権限を配る。それを再現する
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
"""

A = '11111111-1111-1111-1111-111111111111'
B = '22222222-2222-2222-2222-222222222222'
ADM = '33333333-3333-3333-3333-333333333333'
MAIL = '44444444-4444-4444-4444-444444444444'

results = []
PROVIDER_INIT = None
def check(name, ok, detail=''):
    results.append((ok, name, detail))

PROVIDER = {}   # 誰がどの方法でログインしたか
def as_role(cur, role, sub=None):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (sub or '',))
    claims = {'app_metadata': {'provider': PROVIDER[sub], 'providers': [PROVIDER[sub]]}} if sub else {}
    import json
    cur.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
    cur.execute(f'set role {role}')

def expect_error(cur, sql, args=(), name='', contains=None):
    cur.execute('savepoint t')
    try:
        cur.execute(sql, args)
        cur.execute('release savepoint t')
        check(name, False, 'エラーにならなかった')
    except Exception as e:
        cur.execute('rollback to savepoint t')
        msg = str(e).splitlines()[0]
        check(name, contains is None or contains in msg, msg)

def expect_ok(cur, sql, args=(), name=''):
    cur.execute('savepoint t')
    try:
        cur.execute(sql, args)
        rows = cur.fetchall() if cur.description else None
        cur.execute('release savepoint t')
        check(name, True)
        return rows
    except Exception as e:
        cur.execute('rollback to savepoint t')
        check(name, False, str(e).splitlines()[0])
        return None

with psycopg.connect(uri, autocommit=True) as conn:
    cur = conn.cursor()
    cur.execute(SHIM)
    sql = open(SCHEMA, encoding='utf-8').read()
    # 2回流して「何度実行しても壊れない」を確かめる
    for i in (1, 2):
        try:
            cur.execute(sql); check(f'schema.sql {i}回目がエラーなく通る', True)
        except Exception as e:
            check(f'schema.sql {i}回目がエラーなく通る', False, str(e).splitlines()[0]); break

    cur.execute("insert into auth.users values (%s,'a@x',%s),(%s,'b@x','{}'),(%s,'adm@x','{}'),(%s,'mail@x','{}')",
                (A, '{"avatar_url":"https://lh3.googleusercontent.com/a/abc"}', B, ADM, MAIL))
    cur.execute("insert into public.admins values (%s,'管理人','kanri')", (ADM,))
    cur.execute("insert into public.works (id,title,image_path) values ('w1','一',''),('w2','二','')")

PROVIDER.update({A: 'google', B: 'google', ADM: 'email', MAIL: 'email'})
conn = psycopg.connect(uri)   # ここからはトランザクションの中で試す
conn.autocommit = False
cur = conn.cursor()

# ---------- ログインしていない人 ----------
as_role(cur, 'anon')
expect_ok(cur, 'select id from public.works', name='[未ログイン] 作品は見られる')
expect_ok(cur, 'select * from public.work_stats()', name='[未ログイン] 数の集計は見られる')
expect_ok(cur, "select public.register_view('w1', gen_random_uuid())", name='[未ログイン] 閲覧数は数えられる')
expect_error(cur, 'select * from public.hearts', name='[未ログイン] 誰がいいねしたかは読めない')
expect_error(cur, 'select * from public.work_views', name='[未ログイン] 閲覧の中身は読めない')
expect_error(cur, "select public.toggle_heart('w1')", name='[未ログイン] いいねできない')
expect_error(cur, "select public.create_comment('w1',null,'やあ','名','star','#ff0000',false)",
             name='[未ログイン] コメントできない')
expect_error(cur, "insert into public.comments (work_id,name,body) values ('w1','x','直接')",
             name='[未ログイン] コメントを直接書き込めない')

# ---------- ログインした人 A ----------
as_role(cur, 'authenticated', A)
r = expect_ok(cur, "select public.create_comment('w1',null,'こんにちは','Aさん','star','#3d7ea6',false)",
              name='[A] コメントできる')
cid = r[0][0] if r else None
row = expect_ok(cur, 'select user_id, created_at <= now() + interval \'1 second\' from public.comments where id=%s', (cid,),
                name='[A] コメントを読める')
check('[A] 書いた人はサーバーが決めた自分になっている', bool(row) and str(row[0][0]) == A)

expect_error(cur, "select public.create_comment('w1',null,'x','A','star','\"><img src=x onerror=alert(1)>',false)",
             name='[A] 色に変な文字列を入れると弾かれる')
expect_error(cur, "select public.create_comment('w1',null,'x','A','<script>','#ff0000',false)",
             name='[A] アイコン名に変な文字列を入れると弾かれる')
expect_error(cur, "select public.create_comment('w2',%s,'返信','A','star','#ff0000',false)", (cid,),
             name='[A] 別の作品のコメントには返信できない', contains='返信先')
expect_ok(cur, "select public.create_comment('w1',%s,'返信','A','star','#ff0000',false)", (cid,),
          name='[A] 同じ作品のコメントには返信できる')
expect_error(cur, "select public.create_comment('w1',null,'','A','star','#ff0000',false)",
             name='[A] 空のコメントは弾かれる')
expect_error(cur, "insert into public.comments (work_id,name,body,user_id,created_at) values ('w1','偽','直接',%s,'2099-01-01')", (B,),
             name='[A] 他人の名義や未来の日付で直接書き込めない')
expect_error(cur, "update public.comments set body='書き換え' where id=%s", (cid,),
             name='[A] コメントを書き換えられない')

pid = expect_ok(cur, "select public.create_comment('w2',null,'写真','A',null,null,true)",
                name='[A] Googleの写真でコメントできる')
photo = expect_ok(cur, 'select avatar_url, avatar_icon from public.comments where id=%s', (pid[0][0],),
                  name='[A] 写真のコメントを読む') if pid else None
check('[A] 写真のURLはログイン情報から取られる', bool(photo) and photo[0][0] == 'https://lh3.googleusercontent.com/a/abc', str(photo))

# 連投の上限（1分に5件）。ここまでで A は 3件書いている
for i in range(2):
    expect_ok(cur, "select public.create_comment('w1',null,'連投','A','star','#ff0000',false)", name=f'[A] 連投{i+4}件目は通る')
expect_error(cur, "select public.create_comment('w1',null,'連投','A','star','#ff0000',false)",
             name='[A] 1分に6件目は弾かれる', contains='時間をおいて')

on = expect_ok(cur, "select public.toggle_heart('w1')", name='[A] いいねできる')
check('[A] いいねが付いた', bool(on) and on[0][0] is True)
mine = expect_ok(cur, 'select user_id from public.hearts', name='[A] 自分のいいねは見える')

cur.execute('savepoint d')
cur.execute('delete from public.comments')
check('[A] 管理人じゃないのでコメントを消せない(0件)', cur.rowcount == 0, f'{cur.rowcount}件消えた')
cur.execute('rollback to savepoint d')

# ---------- 別の人 B ----------
as_role(cur, 'authenticated', B)
seen = expect_ok(cur, 'select user_id from public.hearts', name='[B] hearts を読める(自分の分だけ)')
check('[B] Aのいいねは見えない', seen == [])
expect_ok(cur, "select public.toggle_heart('w1')", name='[B] いいねできる')
st = expect_ok(cur, "select hearts from public.work_stats() where work_id='w1'", name='[B] 集計を読める')
check('[B] いいね数は2(AとBの分)', bool(st) and st[0][0] == 2, str(st))
off = expect_ok(cur, "select public.toggle_heart('w1')", name='[B] もう一度押すと外れる')
check('[B] 外れたのはBの分だけ', bool(off) and off[0][0] is False)
st = expect_ok(cur, "select hearts from public.work_stats() where work_id='w1'", name='[B] 集計をもう一度読む')
check('[B] Aのいいねは残っている(1)', bool(st) and st[0][0] == 1, str(st))
cur.execute('savepoint w')
cur.execute("update public.works set title='乗っ取り' where id='w1'")
check('[B] 作品は書き換えられない', cur.rowcount == 0, f'{cur.rowcount}件')
cur.execute('rollback to savepoint w')

# ---------- メールで勝手に登録した人 ----------
as_role(cur, 'authenticated', MAIL)
expect_error(cur, "select public.toggle_heart('w1')", name='[メール登録] いいねできない')
expect_error(cur, "select public.create_comment('w1',null,'x','M','star','#ff0000',false)",
             name='[メール登録] コメントできない')

# ---------- 管理人（メールでログイン） ----------
as_role(cur, 'authenticated', ADM)
cur.execute('savepoint a')
cur.execute('delete from public.comments where id=%s', (cid,))
check('[管理人] コメントを消せる', cur.rowcount == 1, f'{cur.rowcount}件')
cur.execute('rollback to savepoint a')
cur.execute("update public.works set title='更新' where id='w2'")
check('[管理人] 作品を書き換えられる', cur.rowcount == 1)
expect_ok(cur, "select public.create_comment('w1',null,'管理人です','管理人','leaf','#3f6b46',false)",
          name='[管理人] メールでログインしていてもコメントできる')

conn.rollback()
conn.close()

fails = [r for r in results if not r[0]]
for ok, name, detail in results:
    print(('OK  ' if ok else 'NG  ') + name + (f'  … {detail}' if detail and not ok else ''))
print(f'\n{len(results) - len(fails)}/{len(results)} 通過')
