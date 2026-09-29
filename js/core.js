/* ============================================================
   core.js — 土台
   ------------------------------------------------------------
   小道具（$ / esc / 日付）、画面の状態を入れる state、トースト。
   ここは他の全部から使われる。いちばん先に読む。

   ※ 読み込む順番が決まっている（index.html を参照）
       core → feed → pages → profile-ui → viewer → app
   ============================================================ */
'use strict';

/* ============================================================
   小道具
   ============================================================ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const fmtDate  = d => String(d ?? '').replace(/-/g, '.');
const fmtCount = n => n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n ?? 0);
const todayStr = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 「3時間前」「昨日」みたいな出し方 */
function relTime(dateStr) {
  if (!dateStr) return '';
  const t = new Date(String(dateStr).length <= 10 ? dateStr + 'T12:00:00' : dateStr);
  if (isNaN(t)) return fmtDate(dateStr);
  const sec = (Date.now() - t.getTime()) / 1000;
  if (sec < 0)      return fmtDate(dateStr);
  if (sec < 3600)   return `${Math.max(1, Math.floor(sec / 60))}分前`;
  if (sec < 86400)  return `${Math.floor(sec / 3600)}時間前`;
  const days = Math.floor(sec / 86400);
  if (days === 1)   return '昨日';
  if (days < 7)     return `${days}日前`;
  if (days < 31)    return `${Math.floor(days / 7)}週間前`;
  return fmtDate(dateStr);
}

const CFG = window.TSUBAKI_CONFIG || {};
const FEED_STEP = 6;   /* フィードを何件ずつ足すか */

/* ============================================================
   画面の状態
   ============================================================ */
const state = {
  online: false,
  tag:    '',
  site:   { title: '', tagline: '', links: [], artists: {},
            bgImage: '', bgMode: 'cover', bgDim: .25,
            theme: {}, sections: {}, customCss: '' },
  pickup: { message: '', workIds: [], youtubeId: '', youtubeTitle: '' },
  gallery: [],
  blog: [],
  stats: {},
  myHearts: new Set(),
  account: null,
  page: 'home',
  sort: 'recent',
  artist: '',
  visible: [],     // いま並んでいる順（←→送りで使う）
  feedShown: 0,
};

let api;       /* 読み書き。本番なら DB.api、見本なら Demo.api */
let authApi;   /* ログイン。本番なら DB.auth、見本なら Demo.auth */

const statOf   = id => state.stats[id] || { views: 0, hearts: 0, comments: 0 };
const workById = id => state.gallery.find(w => w.id === id);
const artistOf = key => state.site.artists?.[key] || { name: key || '不明', color: '#6b5a4a', icon: 'camellia' };

const score = id => {
  const s = statOf(id);
  return s.hearts * 5 + s.comments * 3 + s.views * 0.1;
};

const avatar = (av, size) => Profile.avatarHTML(av, size);
const artistAvatar = (key, size = 40) => {
  const a = artistOf(key);
  return avatar({ icon: a.icon || 'camellia', color: a.color }, size);
};

/** 並び替え・絞り込みを適用した一覧 */
function currentList() {
  let list = state.gallery.slice();
  if (state.artist) list = list.filter(w => w.artist === state.artist);
  if (state.tag)    list = list.filter(w => (w.tags || []).includes(state.tag));
  list.sort(state.sort === 'popular'
    ? (a, b) => score(b.id) - score(a.id)
    : (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return list;
}


/* ============================================================
   トースト（一瞬出るお知らせ）
   ============================================================ */
let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}


/* ============================================================
   見た目を当てる（テーマ・ページの出し分け・自分で足すCSS）
   ------------------------------------------------------------
   style.css の :root に入っている値を、設定で上書きする。
   CSS変数を書き換えるだけなので、どの部品も自動で追従する。
   ============================================================ */

const FONT_STACKS = {
  sans:  '"Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic",Meiryo,system-ui,sans-serif',
  serif: '"Yu Mincho","YuMincho","Hiragino Mincho ProN","Noto Serif JP",serif',
  round: '"Zen Maru Gothic","Hiragino Maru Gothic ProN","M PLUS Rounded 1c",sans-serif',
};

/** #rrggbb を少し暗くする（hover 用の色を自動で作る） */
function darken(hex, amount) {
  const m = String(hex || '').replace('#', '');
  if (m.length !== 6) return hex;
  const p = [0, 2, 4].map(i => {
    const v = Math.round(parseInt(m.slice(i, i + 2), 16) * (1 - amount));
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  });
  return '#' + p.join('');
}

function applyTheme() {
  const t = state.site.theme || {};
  const r = document.documentElement.style;

  if (t.camellia) {
    r.setProperty('--camellia', t.camellia);
    r.setProperty('--camellia-dark', darken(t.camellia, 0.3));
  }
  if (t.gold)  r.setProperty('--gold', t.gold);
  if (t.ink) {
    r.setProperty('--ink', t.ink);
    r.setProperty('--ink-soft',  darken(t.ink, -0.45) || t.ink);
  }
  if (t.paper) {
    r.setProperty('--paper', t.paper);
    r.setProperty('--paper-edge', darken(t.paper, 0.05));
  }
  if (t.wood) {
    /* 壁の色。明るさ違いを4段つくって木目にする */
    r.setProperty('--wood-2', t.wood);
    r.setProperty('--wood-1', darken(t.wood, -0.18));
    r.setProperty('--wood-3', darken(t.wood, 0.18));
    r.setProperty('--wood-4', darken(t.wood, -0.32));
  }
  if (t.radius !== undefined && t.radius !== null) r.setProperty('--radius', t.radius + 'px');
  if (t.feedW)  r.setProperty('--feed-w', t.feedW + 'px');
  if (t.font && FONT_STACKS[t.font]) r.setProperty('--font-sans', FONT_STACKS[t.font]);

  /* 影の強さ。0 にすると影が消える */
  if (t.shadow !== undefined && t.shadow !== null) {
    const k = Math.max(0, Math.min(200, Number(t.shadow))) / 100;
    r.setProperty('--shadow-k', String(k));
    document.body.classList.toggle('no-shadow', k === 0);
  }
}

/** 下のナビに出すページを、設定どおりにする */
function applySections() {
  const sec = state.site.sections || {};
  let firstOn = null;
  document.querySelectorAll('.bottomnav button[data-page]').forEach(b => {
    const key = b.dataset.page;
    const conf = sec[key];
    const on = !conf || conf.on !== false;
    b.hidden = !on;
    if (on && !firstOn) firstOn = key;
    if (conf && conf.label) {
      const span = b.querySelector('span');
      if (span) span.textContent = conf.label;
    }
  });
  /* 今いるページが消されていたら、残っている最初のページへ逃がす */
  if (firstOn && sec[state.page] && sec[state.page].on === false) showPage(firstOn);
}

/** 管理ページで書いたCSSを、いちばん最後に効かせる */
function applyCustomCss() {
  let el = document.getElementById('customCss');
  if (!el) {
    el = document.createElement('style');
    el.id = 'customCss';
    document.head.appendChild(el);
  }
  el.textContent = state.site.customCss || '';
}

/** 3つまとめて */
/** 作品が持っている画像を配列で返す。
    1枚だけの投稿でも、複数枚の投稿でも、これを通せば同じ形になる。
    画像のない投稿（文章だけ）は空の配列。 */
function filesOf(w) {
  if (Array.isArray(w?.files) && w.files.length) return w.files.filter(Boolean);
  return w?.file ? [w.file] : [];
}

/** 文章だけの投稿か */
function isTextPost(w) { return filesOf(w).length === 0; }

function applyLook() {
  applyTheme();
  applySections();
  applyCustomCss();
}
