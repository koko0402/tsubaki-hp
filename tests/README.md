# テスト

変更したら、この3つを流して全部 OK になるか確かめる。

| ファイル | 何を確かめるか | 流し方（椿HP フォルダで） |
|---|---|---|
| `db_test.py` | `supabase/schema.sql` を本物の PostgreSQL に流して、ログインしていない人・他人・メール登録の人が、できないはずのことをできないか | `uvx --python 3.12 --with "psycopg[binary]" --from pgserver python tests/db_test.py supabase/schema.sql` |
| `ui_test.js` | 見本モードで、ログイン → いいね → コメント → ログアウトを実際に操作する（スマホの幅） | `node tests/ui_test.js . <スクショを置くフォルダ>` |
| `kanri_test.js` | 管理ページが開いて、サイト設定を保存できるか | `node tests/kanri_test.js . <スクショを置くフォルダ>` |

- `db_test.py` は Supabase の中身（ログインの仕組みなど）を最小限まねした模造品の上で動く。本物の Supabase で最後に確かめるのは別
- ブラウザのテストは Edge を画面なしで動かす
- 日本語が化けるときは、先に `$env:PYTHONUTF8=1`（PowerShell）
