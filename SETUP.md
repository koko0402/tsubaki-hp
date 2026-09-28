# セットアップ手順（Supabase）

ここまで終わると、❤・コメント・閲覧数が **みんなで共有される本物の数字** になり、
管理ページからそのまま絵を投稿できるようになります。

だいたい 20〜30分。お金はかかりません（無料枠で足ります）。

---

## 1. Supabase のプロジェクトを作る

1. https://supabase.com/ で新規登録（GitHub アカウントでも可）
2. **New project** を押す
3. 入力するもの
   - **Name**: `tsubaki-hp` など何でも
   - **Database Password**: 自動生成でOK。**どこかに控えておく**
   - **Region**: `Northeast Asia (Tokyo)` を選ぶと速い
4. 作成に2分ほどかかります

---

## 2. データの置き場所を作る

1. 左メニューの **SQL Editor** を開く
2. **New query**
3. このフォルダの `supabase/schema.sql` を **まるごとコピーして貼り付ける**
4. **Run**（`Ctrl + Enter`）

`Success. No rows returned` と出れば成功です。

これで、表・「誰が何をできるか」のルール・画像置き場が一度に作られます。

---

## 3. あなたと椿さんのアカウントを作る

1. 左メニューの **Authentication** → **Users**
2. **Add user** → **Create new user**
3. メールアドレスと合言葉（パスワード）を入れる
   - **Auto Confirm User** に必ずチェック（メール確認を省略できます）
4. 椿さんのぶんも同じように作る

> 合言葉は 8文字以上にしてください。ここで決めたものが、管理ページのログインに使うものです。

---

## 4. 勝手に登録されないようにする ★重要

1. **Authentication** → **Sign In / Providers**（または **Providers** → **Email**）
2. **Allow new users to sign up** を **オフ** にする

これをやらないと、第三者が自分でアカウントを作れてしまいます。
（作られても次の 5 の `admins` に載っていなければ投稿はできませんが、二重に止めておきます）

> **見に来た人にも Google ログインを使わせたい場合は、ここをオフにできません。**
> その場合はオンのままにしてください。投稿できるかどうかは `admins` テーブルで
> 決まっているので、他人がアカウントを作っても絵を貼ることはできません。
> → 下の「Googleログインを使う場合」を参照。

---

## 5. 「投稿していい人」として登録する

1. **SQL Editor** に戻る
2. 下を貼って、メールアドレスを **3 で作ったもの** に書き換えて Run

```sql
insert into public.admins (user_id, display_name, artist_key)
select id, '管理人', 'kanri' from auth.users where email = 'あなたのメール@example.com'
on conflict (user_id) do nothing;

insert into public.admins (user_id, display_name, artist_key)
select id, '椿', 'tsubaki' from auth.users where email = '椿さんのメール@example.com'
on conflict (user_id) do nothing;
```

`Success` かつ 2 行ぶん入れば完了です。確認したいときは:

```sql
select * from public.admins;
```

---

## 6. 鍵をサイトに教える

1. 左下の **Project Settings** → **API**
2. 次の2つをコピー
   - **Project URL**（`https://xxxxxxxx.supabase.co`）
   - **anon** の **public** キー（`eyJ...` で始まる長い文字列）
3. このフォルダの `config.js` を開いて貼る

```js
window.TSUBAKI_CONFIG = {
  supabaseUrl:     'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  storageBucket:   'art',
};
```

> **anon キーは公開して大丈夫な値です。** ページのソースに出るのが前提の鍵で、
> 何ができるかは手順2で入れたルールで決まっています。
>
> **`service_role` の方は絶対に貼らないでください。** あれは全権限の鍵です。

---

## 7. ローカルで動かして確認する

`index.html` をダブルクリックで開く方法だと、ブラウザの制限で
Supabase と通信できないことがあります。簡易サーバー経由で開いてください。

PowerShell で、このフォルダを開いた状態で:

```powershell
# Python が入っているなら
python -m http.server 8000

# Node.js が入っているなら
npx --yes serve -l 8000
```

そのあとブラウザで:

- サイト → http://localhost:8000/
- 管理 → http://localhost:8000/kanri-7f3a2c/

管理ページで 3 のメールと合言葉を入れてログイン → 絵をアップロードしてみてください。
サイト側に出てきたら成功です。

うまくいかないときは、ブラウザで `F12` → **Console** タブにエラーが出ています。

---

## 8. コメントの入口をどうするか

コメントには段階が2つあります。管理ページの **サイト設定** で切り替えられます。

### 標準：なまえ＋アイコンが必要（初期設定）

見に来た人は、ヘッダーの「プロフィールを作る」からなまえとアイコンを決めます。
決めるまでコメント欄は開きません。プロフィールはその人のブラウザに保存されます。

これは **画面側のお願い** です。捨てアカ的な連投を面倒にする程度の効果で、
本気で回避しようと思えば回避できます。ふつうの荒らし避けとしては十分機能します。

### 強い方：Googleログインを必須にする

管理ページの **サイト設定** →「コメントに Google ログインを必須にする」をオン。
これは **サーバー側で弾きます**（`supabase/schema.sql` のルール）。
ログインしていない書き込みはAPIを直接叩いても通りません。

荒らされてから切り替えても大丈夫です。最初はオフのままで問題ありません。

### Googleログインを使う場合の設定

1. Google Cloud Console で OAuth クライアントIDを作る
   （Supabase の **Authentication → Sign In / Providers → Google** に、
   貼るべきリダイレクトURLが表示されています。それを Google 側に登録します）
2. 取得した **Client ID** と **Client Secret** を Supabase の Google 欄に貼って有効化
3. **Authentication → URL Configuration** の **Site URL** に公開後のURLを入れる
4. 手順4の「Allow new users to sign up」は **オンのまま** にする
5. `config.js` の `enableGoogleLogin` を `true` にする

Googleを使わないなら、この節はまるごと飛ばしてください。
`enableGoogleLogin: false` のままで、なまえ＋アイコンだけで運用できます。

---

## 9. インターネットに公開する

静的ファイルだけなので、置くだけで動きます。無料でおすすめの順:

| 置き場所 | やり方 |
|---|---|
| **Netlify Drop** | https://app.netlify.com/drop にこのフォルダをドラッグするだけ |
| **Cloudflare Pages** | GitHub と繋ぐ。独自ドメインも無料 |
| **GitHub Pages** | リポジトリに push → Settings → Pages |

公開したら、Supabase の **Project Settings → API → CORS**（または Authentication → URL Configuration）に
公開後のURLを入れておくと安心です。

---

## 覚えておくこと

- **管理ページのURLは秘密にしてください。** `kanri-7f3a2c/` はどこからもリンクしていません。
  ただし、これは鍵ではなく目隠しです。本当の鍵は手順4・5で入れたサーバー側のルールの方。
- 無料枠の Supabase は、1週間まったくアクセスがないと一時停止します。
  管理画面から再開できます（データは消えません）。
- `config.js` を空に戻せば、いつでも見本データ表示（`js/data.js`）に戻せます。

---

## 困ったときの見どころ

| 症状 | 見るところ |
|---|---|
| 「見本データを表示しています」と出る | `config.js` の2つの値。前後の空白や引用符に注意 |
| ログインで「メールアドレスか合言葉がちがいます」 | 手順3のユーザー。**Auto Confirm** を忘れていないか |
| 「このアカウントには投稿の権限がありません」 | 手順5の `admins` への登録漏れ |
| 画像をアップできない | 手順2のSQLが最後まで通ったか（`art` バケットが作られたか） |
| 絵が出ない・数字が動かない | `F12` → Console のエラー文 |
