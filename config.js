/* ============================================================
   config.js — ここだけ書き換えれば、サーバーにつながります
   ------------------------------------------------------------
   Supabase の管理画面 → Project Settings → API から
   「Project URL」と「anon public」キーをコピーして貼ってください。

   ※ この2つは公開して大丈夫な値です（ページのソースに出ます）。
     絶対に貼ってはいけないのは "service_role" の方。あれは全権限の鍵です。
     何ができるかは supabase/schema.sql のルールで決まっているので、
     anon キーが見えても他人が絵を消したりはできません。

   空のままにしておくと、js/data.js の見本データで表示されます。
   ============================================================ */

window.TSUBAKI_CONFIG = {
  supabaseUrl:     '',   // 例: 'https://abcdefghijklm.supabase.co'
  supabaseAnonKey: '',   // 例: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

  storageBucket:   'art',

  /* 見に来た人のログインは Google です。見るだけならログインはいりません。
     いいね・コメントをするにはログインが必要なので、
     Supabase 側で Google ログインを有効にしてください（SETUP.md の手順8）。 */
};
