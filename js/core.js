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
            bgImage: '', bgMode: 'cover', bgDim: .25, requireLogin: false },
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

let api;

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
