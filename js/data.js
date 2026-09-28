/* ============================================================
   data.js  —  サイトの中身はぜんぶここを書き換えるだけでOK
   ------------------------------------------------------------
   ※ いまは「見た目の確認用」なので、このファイルが中身の全部です。
     サーバー(DB)をつなぐ段階になったら、ここは自動で読み込む形に
     差し替えます。書き方(項目名)はそのまま使うので、今のうちに
     ここに書きためておいて大丈夫です。
   ============================================================ */

/* ---------- サイト全体の設定 ---------- */
const SITE = {
  title: '椿@お絵描き局',
  tagline: '絵を展示する場所',

  /* 上に並ぶリンク。不要な行は消す / 増やしたい時は同じ形で足す */
  links: [
    { label: 'X (Twitter)', url: 'https://x.com/',        icon: 'x' },
    { label: 'pixiv',       url: 'https://www.pixiv.net/', icon: 'pixiv' },
    { label: 'YouTube',     url: 'https://www.youtube.com/', icon: 'youtube' },
  ],

  /* 背景の絵。空っぽなら木目のまま。
     bgImage : images/ の中のファイル名（例 'images/haikei.png'）。
               管理ページから貼った画像のURLでもOK
     bgMode  : 'cover' 全面に伸ばす ／ 'tile' 並べて敷き詰める
     bgDim   : 背景を暗くする度合い 0〜0.7。絵が明るくて文字が読みにくいときに上げる */
  bgImage: '',
  bgMode:  'cover',
  bgDim:   0.25,

  /* 投稿者（絵を貼れる人）。表示名・色・アイコン。ログインとは別物
     icon に使えるもの: camellia / star / moon / cat / leaf / drop / note / heart */
  artists: {
    tsubaki: { name: '椿',   color: '#c62b3d', icon: 'camellia' },
    kanri:   { name: '管理人', color: '#3f6b46', icon: 'leaf' },
  },
};

/* ---------- 製作者のおすすめ（いちばん上に出る） ---------- */
const PICKUP = {
  message: '今いちばん見てほしいやつ。気が向いたら入れ替えます。',

  /* おすすめにしたい作品の id を並べる（GALLERY の id と合わせる） */
  workIds: ['w003', 'w001'],

  /* YouTube を出したい時だけ動画IDを入れる。空文字なら非表示になる。
     例: https://www.youtube.com/watch?v=XXXXXXXXXXX  →  'XXXXXXXXXXX'  */
  youtubeId: '',
  youtubeTitle: 'メイキング動画',
};

/* ---------- ギャラリー（作品一覧） ----------
   file    : images/ の中のファイル名
   artist  : SITE.artists のキー（tsubaki / kanri）
   date    : YYYY-MM-DD
   baseViews / baseHearts : 開設前からの数字を持たせたい時に使う。0でOK
   comments: 最初から付けておきたいコメント
------------------------------------------------ */
const GALLERY = [
  {
    id: 'w001',
    title: '夕暮れの帰り道',
    file: 'images/sample01.svg',
    artist: 'tsubaki',
    date: '2026-08-10',
    desc: '空の色をやりたかっただけの絵。',
    tags: ['風景', '夕焼け'],
    baseViews: 312, baseHearts: 48,
    comments: [
      { name: 'ななし', text: '空の色すき', date: '2026-08-11',
        avatar: { icon: 'star', color: '#3d7ea6' } },
    ],
  },
  {
    id: 'w002',
    title: '海のうた',
    file: 'images/sample02.svg',
    artist: 'tsubaki',
    date: '2026-08-06',
    desc: '波を重ねるのが楽しかった。',
    tags: ['風景', '海'],
    baseViews: 198, baseHearts: 26,
    comments: [],
  },
  {
    id: 'w003',
    title: '椿',
    file: 'images/sample03.svg',
    artist: 'tsubaki',
    date: '2026-08-01',
    desc: 'ハンドルネームの花。看板がわり。',
    tags: ['花'],
    baseViews: 540, baseHearts: 97,
    comments: [
      { name: 'とおりすがり', text: '色が強くていい', date: '2026-08-02',
        avatar: { icon: 'cat', color: '#e0783c' } },
      { name: 'ななし', text: 'アイコンにしてほしい', date: '2026-08-03',
        avatar: { icon: 'note', color: '#7a5ba8' } },
    ],
  },
  {
    id: 'w004',
    title: '眠らない窓',
    file: 'images/sample04.svg',
    artist: 'kanri',
    date: '2026-07-28',
    desc: '夜のビル。窓ひとつずつ塗った。',
    tags: ['夜', '街'],
    baseViews: 143, baseHearts: 19,
    comments: [],
  },
  {
    id: 'w005',
    title: '朝の森',
    file: 'images/sample05.svg',
    artist: 'tsubaki',
    date: '2026-07-20',
    desc: '奥に行くほど薄くするやつの練習。',
    tags: ['風景', '森'],
    baseViews: 221, baseHearts: 34,
    comments: [],
  },
  {
    id: 'w006',
    title: 'まる',
    file: 'images/sample06.svg',
    artist: 'kanri',
    date: '2026-07-11',
    desc: '落書き。',
    tags: ['落書き'],
    baseViews: 88, baseHearts: 11,
    comments: [],
  },
];

/* ---------- ブログ / お知らせ ----------
   body は改行で段落になります。pinned:true で一番上に固定。
------------------------------------------------ */
const BLOG = [
  {
    id: 'b003',
    date: '2026-08-12',
    title: 'サイトつくってます',
    pinned: true,
    body: `絵を置いておく場所がほしかったので作りはじめました。
まだ見た目を試している最中なので、置いてある絵は仮のものです。

・気に入ったら ❤ を押せます
・コメントもどうぞ
・画像はクリックすると大きく見られます`,
  },
  {
    id: 'b002',
    date: '2026-08-05',
    title: '最近の話',
    body: `厚塗りの練習をしています。
影の付け方がまだ掴めてない。`,
  },
  {
    id: 'b001',
    date: '2026-07-11',
    title: 'はじめまして',
    body: `椿です。絵を描いています。
のんびり更新します。`,
  },
];
