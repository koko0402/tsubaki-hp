/* ============================================================
   app.js — 画面を組み立てる／拡大・ハート・コメントの動き
   ------------------------------------------------------------
   形は LINE VOOM に寄せています。
     上のバー ＋ 縦に流れるフィード ＋ 下のナビ
   データの出どころは2通り。
     ・config.js が設定済み → Supabase（みんなで数字を共有する本番）
     ・空のまま             → js/data.js の見本データ（このブラウザ内だけ）
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

/* ============================================================
   ヘッダー
   ============================================================ */
const SNS_ICONS = {
  x: '<svg viewBox="0 0 24 24"><path d="M18.9 2H22l-7.1 8.1L23 22h-6.6l-5.1-6.7L5.4 22H2.3l7.6-8.7L1.7 2h6.8l4.6 6.1L18.9 2Zm-1.2 18h1.8L7.4 3.9H5.5L17.7 20Z"/></svg>',
  youtube: '<svg viewBox="0 0 24 24"><path d="M23 12s0-3.4-.4-5c-.2-.9-1-1.6-1.9-1.9C19 4.7 12 4.7 12 4.7s-7 0-8.7.4c-.9.3-1.7 1-1.9 1.9C1 8.6 1 12 1 12s0 3.4.4 5c.2.9 1 1.6 1.9 1.9 1.7.4 8.7.4 8.7.4s7 0 8.7-.4c.9-.3 1.7-1 1.9-1.9.4-1.6.4-5 .4-5ZM9.8 15.3V8.7l5.8 3.3-5.8 3.3Z"/></svg>',
};

/* 背景の絵を貼る。設定が空なら木目のまま */
function applyBackground() {
  const el = $('#siteBg');
  if (!el) return;
  const url = (state.site.bgImage || '').trim();

  if (!url) {
    el.hidden = true;
    el.style.backgroundImage = '';
    document.body.classList.remove('has-bg', 'bg-tile');
    return;
  }

  el.hidden = false;
  el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
  document.body.classList.add('has-bg');
  document.body.classList.toggle('bg-tile', state.site.bgMode === 'tile');

  const dim = Math.min(.7, Math.max(0, Number(state.site.bgDim ?? .25)));
  document.body.style.setProperty('--bg-dim', String(dim));
}

function renderHeader() {
  document.title = state.site.title;
  $('#siteTitle').textContent   = state.site.title;
  $('#footerTitle').textContent = state.site.title;
  $('#siteTagline').textContent = state.site.tagline;

  $('#snsNav').innerHTML = (state.site.links || []).map(l => `
    <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
      ${SNS_ICONS[l.icon] || ''}<span>${esc(l.label)}</span>
    </a>`).join('');

  applyBackground();
  renderProfileChip();
}

function renderProfileChip() {
  const p = Profile.get();
  const chip = $('#profileChip');
  if (p) {
    chip.className = 'topbar-profile';
    chip.innerHTML = `${avatar(p, 26)}<span>${esc(p.name)}</span>`;
    chip.title = 'プロフィールを変える';
  } else {
    chip.className = 'topbar-profile is-empty';
    chip.innerHTML = '<span>プロフィール</span>';
    chip.title = 'コメントするのに必要です';
  }
}

/* ============================================================
   おすすめ（横に流れる）
   ============================================================ */
function renderPickup() {
  const picks = (state.pickup.workIds || []).map(workById).filter(Boolean);
  const hasVideo = !!state.pickup.youtubeId;

  $('#pickup').hidden = picks.length === 0 && !hasVideo;
  $('#pickupMessage').textContent = state.pickup.message || '';

  $('#pickupRail').innerHTML = picks.map(w => {
    const s = statOf(w.id);
    return `
    <button type="button" class="strip-card" data-open="${esc(w.id)}">
      <img src="${esc(w.file)}" alt="${esc(w.title)}" loading="lazy">
      <b>${esc(w.title)}</b>
      <small>❤ ${fmtCount(s.hearts)} ・ 💬 ${fmtCount(s.comments)}</small>
    </button>`;
  }).join('');

  const box = $('#pickupVideo');
  if (hasVideo) {
    box.hidden = false;
    box.innerHTML = `
      <h3>${esc(state.pickup.youtubeTitle || '動画')}</h3>
      <div class="ratio">
        <iframe src="https://www.youtube-nocookie.com/embed/${esc(state.pickup.youtubeId)}"
                title="${esc(state.pickup.youtubeTitle || '動画')}"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                referrerpolicy="strict-origin-when-cross-origin"
                allowfullscreen></iframe>
      </div>`;
  } else {
    box.hidden = true;
    box.innerHTML = '';
  }
}

/* ============================================================
   フィード（VOOM風）
   ============================================================ */
function writeBoxHTML(id) {
  const check = commentCheck();
  if (!check.ok) {
    const label = check.why === 'google'
      ? 'コメントするにはGoogleログインが必要です'
      : 'コメントするにはプロフィールが必要です';
    const attr  = check.why === 'google' ? 'data-google-login' : 'data-open-profile';
    return `<button type="button" class="need-profile" ${attr}>${label}</button>`;
  }
  const p = Profile.get();
  return `
    ${avatar(p, 28)}
    <input type="text" maxlength="400" placeholder="コメントを書く" aria-label="コメントを書く">
    <button type="submit">送信</button>`;
}

function postHTML(w) {
  const a = artistOf(w.artist);
  const s = statOf(w.id);
  const on = state.myHearts.has(w.id);
  return `
  <article class="post" data-work="${esc(w.id)}">
    <header class="post-head">
      ${artistAvatar(w.artist, 40)}
      <div class="post-who">
        <div class="post-name">
          ${esc(a.name)}
          <svg class="post-badge" aria-hidden="true"><use href="#pin-camellia"/></svg>
        </div>
        <div class="post-time">${relTime(w.date)}</div>
      </div>
    </header>

    <div class="post-text">
      <h3 class="post-title">${esc(w.title)}</h3>
      ${w.desc ? `<p class="post-desc">${esc(w.desc)}</p>` : ''}
      ${(w.tags || []).length ? `<ul class="post-tags">${w.tags.map(t =>
        `<li><button type="button" data-tag="${esc(t)}">#${esc(t)}</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="post-media">
      <img src="${esc(w.file)}" alt="${esc(w.title)}" loading="lazy"
           role="button" tabindex="0" data-open="${esc(w.id)}">
    </div>

    <div class="post-counts" data-counts>
      <span><i class="ic">👁</i>${fmtCount(s.views)}</span>
      <span><i class="ic">❤</i>${fmtCount(s.hearts)}</span>
      <span><i class="ic">💬</i>${fmtCount(s.comments)}</span>
    </div>

    <div class="post-actions">
      <button type="button" data-heart="${esc(w.id)}" class="${on ? 'is-on' : ''}">
        <svg aria-hidden="true"><use href="#${on ? 'ic-heart' : 'ic-heart-o'}"/></svg>
        <span>${on ? 'いいね済み' : 'いいね'}</span>
      </button>
      <button type="button" data-open="${esc(w.id)}">
        <svg aria-hidden="true"><use href="#ic-comment"/></svg><span>コメント</span>
      </button>
      <button type="button" data-share="${esc(w.id)}">
        <svg aria-hidden="true"><use href="#ic-share"/></svg><span>シェア</span>
      </button>
    </div>

    <div class="post-comments" data-comments hidden></div>

    <form class="post-write" data-write="${esc(w.id)}">${writeBoxHTML(w.id)}</form>
  </article>`;
}

/** フィードを描く。reset=true で最初から */
function renderFeed(reset) {
  const feed = $('#feed');
  if (reset) {
    state.visible = currentList();
    state.feedShown = 0;
    feed.innerHTML = '';
  }

  const next = state.visible.slice(state.feedShown, state.feedShown + FEED_STEP);
  if (next.length) {
    feed.insertAdjacentHTML('beforeend', next.map(postHTML).join(''));
    state.feedShown += next.length;
    fillPostComments(next.map(w => w.id));
  }

  $('#feedSentinel').hidden = state.feedShown >= state.visible.length;
  $('#emptyNote').hidden    = state.visible.length > 0;

  const sum = k => state.visible.reduce((n, w) => n + statOf(w.id)[k], 0);
  $('#totals').innerHTML =
    `作品 <b>${state.visible.length}</b> 点 ／ 閲覧 <b>${fmtCount(sum('views'))}</b> ／ ` +
    `❤ <b>${fmtCount(sum('hearts'))}</b> ／ コメント <b>${fmtCount(sum('comments'))}</b>`;
}

/** 各投稿の下に、新しいコメントを2件ずつ流し込む */
async function fillPostComments(ids) {
  if (!ids.length) return;
  let map = {};
  try { map = await api.recentComments(ids, 2); } catch (err) { console.warn(err); return; }

  for (const id of ids) {
    const box = $(`.post[data-work="${CSS.escape(id)}"] [data-comments]`);
    if (!box) continue;
    const list = map[id] || [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; continue; }

    const total = statOf(id).comments;
    box.hidden = false;
    box.innerHTML =
      list.map(c => `
        <div class="post-c">
          ${avatar(c.avatar, 26)}
          <div class="c-main">
            <span class="c-name">${esc(c.name || 'ななし')}</span>${c.verified ? '<span class="c-verified" title="ログイン済み">✓</span>' : ''}
            <p class="c-text">${esc(c.text)}</p>
          </div>
        </div>`).join('') +
      (total > list.length
        ? `<button type="button" class="post-more" data-open="${esc(id)}">コメント${total}件をすべて見る</button>`
        : '');
  }
}

/** ハートやコメントのあと、その1件だけ描き直す */
function patchPost(id) {
  const card = $(`.post[data-work="${CSS.escape(id)}"]`);
  if (!card) return;
  const s = statOf(id);
  const on = state.myHearts.has(id);

  $('[data-counts]', card).innerHTML =
    `<span><i class="ic">👁</i>${fmtCount(s.views)}</span>` +
    `<span><i class="ic">❤</i>${fmtCount(s.hearts)}</span>` +
    `<span><i class="ic">💬</i>${fmtCount(s.comments)}</span>`;

  const btn = $('[data-heart]', card);
  if (btn) {
    btn.classList.toggle('is-on', on);
    $('use', btn).setAttribute('href', on ? '#ic-heart' : '#ic-heart-o');
    $('span', btn).textContent = on ? 'いいね済み' : 'いいね';
  }
}

/** プロフィールを作った／消したときに、書き込み欄を全部差し替える */
function refreshWriteBoxes() {
  $$('.post-write').forEach(form => {
    form.innerHTML = writeBoxHTML(form.dataset.write);
  });
}

/* ============================================================
   絵だけ／壁
   ============================================================ */
function tileHTML(w) {
  const s = statOf(w.id);
  return `
  <button type="button" class="tile" data-open="${esc(w.id)}" aria-label="${esc(w.title)} を大きく見る">
    <img src="${esc(w.file)}" alt="${esc(w.title)}" loading="lazy">
    <span class="tile-info">
      <b>${esc(w.title)}</b>
      <small>❤ ${fmtCount(s.hearts)} ・ 💬 ${fmtCount(s.comments)}</small>
    </span>
  </button>`;
}

const pinSVG = (cls = 'card-pin') =>
  `<svg class="${cls}" aria-hidden="true"><use href="#pin-camellia"/></svg>`;

function cardHTML(w, i = 0) {
  const a = artistOf(w.artist);
  const s = statOf(w.id);
  return `
  <article class="card" data-rot="${i % 4}" data-pin="${i % 3}">
    ${pinSVG()}
    <div class="card-frame" role="button" tabindex="0" data-open="${esc(w.id)}"
         aria-label="${esc(w.title)} を大きく見る">
      <img class="card-img" src="${esc(w.file)}" alt="${esc(w.title)}" loading="lazy">
      <div class="card-body">
        <h3 class="card-title">${esc(w.title)}</h3>
        <p class="card-sub">
          <span class="artist-chip" style="background:${esc(a.color)}">${esc(a.name)}</span>
          <time>${fmtDate(w.date)}</time>
        </p>
        <div class="card-stats">
          <span title="閲覧数"><i class="ic">👁</i>${fmtCount(s.views)}</span>
          <span title="ハート数" class="${state.myHearts.has(w.id) ? 'hearted' : ''}"><i class="ic">❤</i>${fmtCount(s.hearts)}</span>
          <span title="コメント数"><i class="ic">💬</i>${fmtCount(s.comments)}</span>
        </div>
      </div>
    </div>
  </article>`;
}

/* 画面の幅から、壁を何列にするか決める */
function wallColumnCount() {
  const w = window.innerWidth;
  if (w <= 560) return 1;
  if (w <= 900) return 2;
  return 3;
}

/* 低い列から順にカードを入れていく。
   CSS の columns を使わないのは、loading="lazy" の画像だと
   高さが分からないうちに列が決まり、全部1列目に積まれてしまうためです。 */
function layoutWall() {
  const wall = $('#wall');
  if (!wall || !state.wallCards || !state.wallCards.length) return;

  const n = wallColumnCount();
  const cols = [];
  wall.textContent = '';
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'wall-col';
    wall.appendChild(c);
    cols.push({ el: c, h: 0 });
  }

  state.wallCards.forEach(card => {
    let target = cols[0];
    for (const c of cols) if (c.h < target.h) target = c;
    target.el.appendChild(card);
    target.h += card.getBoundingClientRect().height;   /* 実測して積む */
  });
}

/* 画像が1枚読めるたびに組み直すと重いので、少しまとめてから動かす */
let wallLayoutTimer = null;
function scheduleWallLayout() {
  clearTimeout(wallLayoutTimer);
  wallLayoutTimer = setTimeout(() => {
    if (state.page === 'wall') layoutWall();
  }, 120);
}

function renderWall() {
  state.visible = currentList();
  const wall = $('#wall');

  /* HTML文字列から要素を作っておいて、あとで列に振り分ける */
  state.wallCards = state.visible.map((w, i) => {
    const t = document.createElement('template');
    t.innerHTML = cardHTML(w, i).trim();
    return t.content.firstElementChild;
  });

  wall.textContent = '';
  state.wallCards.forEach(c => wall.appendChild(c));   /* 一度置いて高さを測らせる */
  layoutWall();

  /* まだ読めていない画像は、読めた時点で積み直す */
  state.wallCards.forEach(card => {
    const img = card.querySelector('.card-img');
    if (!img || img.complete) return;
    img.addEventListener('load',  scheduleWallLayout, { once: true });
    img.addEventListener('error', scheduleWallLayout, { once: true });
  });

  $('#wallEmpty').hidden = state.visible.length > 0;
}

/* ============================================================
   ブログ
   ============================================================ */
function renderBlog() {
  const list = state.blog.slice().sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });

  $('#blogList').innerHTML = list.map(p => `
    <article class="blog-item">
      ${pinSVG('blog-pin')}
      <div class="blog-head">
        <time class="blog-date">${fmtDate(p.date)}</time>
        <h3 class="blog-title">${esc(p.title)}</h3>
        ${p.pinned ? '<span class="blog-badge">お知らせ</span>' : ''}
      </div>
      <p class="blog-body">${esc(p.body)}</p>
    </article>`).join('');
  $('#blogEmpty').hidden = list.length > 0;
}

/* ============================================================
   わたし
   ============================================================ */
function renderMe() {
  const p = Profile.get();
  $('#meCard').innerHTML = p
    ? `${avatar(p, 64)}
       <div class="me-info">
         <p class="me-name">${esc(p.name)}</p>
         <p class="me-note">${p.linked ? 'Googleアカウントと紐付け済み' : 'この端末に保存されています'}</p>
       </div>
       <button type="button" data-open-profile>変える</button>`
    : `${avatar(null, 64)}
       <div class="me-info">
         <p class="me-name">まだありません</p>
         <p class="me-note">なまえとアイコンを決めるとコメントできます。</p>
       </div>
       <button type="button" data-open-profile>プロフィールを作る</button>`;

  const liked = state.gallery.filter(w => state.myHearts.has(w.id));
  state.visible = liked;
  $('#likedGrid').innerHTML = liked.map(tileHTML).join('');
  $('#likedEmpty').hidden = liked.length > 0;
}

/* ============================================================
   ページの切り替え
   ============================================================ */
const PAGES = ['home', 'wall', 'blog', 'me'];

function showPage(name, keepScroll) {
  if (!PAGES.includes(name)) name = 'home';
  state.page = name;

  $$('.page').forEach(p => { p.hidden = p.id !== 'page-' + name; });
  $$('.bottomnav button').forEach(b => b.classList.toggle('is-active', b.dataset.page === name));

  if (name === 'home')      renderFeed(true);
  else if (name === 'wall') renderWall();
  else if (name === 'blog') renderBlog();
  else if (name === 'me')   renderMe();

  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

/* 並び替え・絞り込みが変わったら、今のページを描き直す */
function reRenderCurrent() {
  if (state.page === 'home')      renderFeed(true);
  else if (state.page === 'wall') renderWall();
  else if (state.page === 'me')   renderMe();
}

/* ============================================================
   プロフィール
   ============================================================ */
const pf = { icon: 'camellia', color: Profile.COLORS[0], image: null, url: null, linked: false };

function pfPaint() {
  $('#pfPreview').innerHTML = avatar({ icon: pf.icon, color: pf.color, image: pf.image, url: pf.url }, 74);
  $$('#pfIcons button').forEach(b => b.classList.toggle('on', b.dataset.icon === pf.icon));
  $$('#pfColors button').forEach(b => b.classList.toggle('on', b.dataset.color === pf.color));
}

function buildProfileModal() {
  $('#pfIcons').innerHTML = Object.entries(Profile.ICONS).map(([key, v]) =>
    `<button type="button" data-icon="${key}" title="${esc(v.label)}" aria-label="${esc(v.label)}">
       ${avatar({ icon: key, color: '#6b5a4a' }, 32)}
     </button>`).join('');

  $('#pfColors').innerHTML = Profile.COLORS.map(c =>
    `<button type="button" data-color="${c}" style="background:${c}" aria-label="色 ${c}"></button>`).join('');

  $('#pfIcons').addEventListener('click', e => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    pf.icon = b.dataset.icon; pf.image = null; pf.url = null; pfPaint();
  });
  $('#pfColors').addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    pf.color = b.dataset.color; pf.image = null; pf.url = null; pfPaint();
  });

  $$('[data-pfclose]').forEach(el => el.addEventListener('click', closeProfile));
  $('#pfSave').addEventListener('click', saveProfile);
  $('#pfClear').addEventListener('click', () => {
    if (!confirm('プロフィールを消します。よろしいですか？')) return;
    Profile.clear();
    afterProfileChange();
    closeProfile();
  });

  $('#pfGoogleBtn').addEventListener('click', async () => {
    try { await DB.auth.signInWithGoogle(); }
    catch (err) { $('#pfMsg').textContent = err.message; }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#profileModal').hidden) closeProfile();
  });

  buildAvatarMaker();
}


/* ============================================================
   アイコンを作る ── 描く／写真から
   ------------------------------------------------------------
   どちらも 256x256 のキャンバスに描いて、丸く切り抜いた画像を
   data URL にして pf.image に入れる。保存先は localStorage。
   ============================================================ */

const PEN_COLORS = ['#2b2018', '#ffffff', '#c62b3d', '#e0783c', '#e8b84b',
                    '#3f6b46', '#3d7ea6', '#7a5ba8', '#d9639a', '#8a6a4a'];
const BG_COLORS  = ['#ffffff', '#fdf3ec', '#ffe0e4', '#fff1c9',
                    '#d9f0dd', '#d8ecf7', '#e7ddf5', '#2b2018'];

const draw = { pen: PEN_COLORS[0], size: 6, bg: BG_COLORS[0], erasing: false, undo: [] };
const crop = { img: null, zoom: 1, x: 0, y: 0, dragging: false, lx: 0, ly: 0 };

/** 丸く切り抜いて data URL にする */
function toRoundDataURL(src) {
  const out = document.createElement('canvas');
  out.width = out.height = 256;
  const g = out.getContext('2d');
  g.save();
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.clip();
  g.drawImage(src, 0, 0, 256, 256);
  g.restore();
  /* webp が使えれば小さい。だめなら png */
  const webp = out.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png');
}

function buildAvatarMaker() {
  /* ---------- タブ ---------- */
  $$('[data-pftab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.pftab;
      $$('[data-pftab]').forEach(b => b.classList.toggle('is-on', b === btn));
      $$('[data-pfpane]').forEach(p => p.classList.toggle('is-on', p.dataset.pfpane === name));
    });
  });

  /* ---------- ② 描く ---------- */
  const cv = $('#pfDraw');
  const ctx = cv.getContext('2d');

  function wipe(bg) {
    ctx.fillStyle = bg || draw.bg;
    ctx.fillRect(0, 0, 256, 256);
  }
  function pushUndo() {
    draw.undo.push(ctx.getImageData(0, 0, 256, 256));
    if (draw.undo.length > 12) draw.undo.shift();   /* 増やしすぎない */
  }
  wipe();

  $('#pfBrushColors').innerHTML = PEN_COLORS.map((c, i) =>
    '<button type="button" data-pen="' + c + '" class="' + (i === 0 ? 'is-on' : '') +
    '" style="background:' + c + '" aria-label="色"></button>').join('');
  $('#pfBgColors').innerHTML = BG_COLORS.map((c, i) =>
    '<button type="button" data-bg="' + c + '" class="' + (i === 0 ? 'is-on' : '') +
    '" style="background:' + c + '" aria-label="下地"></button>').join('');

  $('#pfBrushColors').addEventListener('click', e => {
    const b = e.target.closest('[data-pen]'); if (!b) return;
    draw.pen = b.dataset.pen; draw.erasing = false;
    $$('#pfBrushColors button').forEach(x => x.classList.toggle('is-on', x === b));
    $('#pfEraser').classList.remove('strong');
  });

  $('#pfBgColors').addEventListener('click', e => {
    const b = e.target.closest('[data-bg]'); if (!b) return;
    pushUndo();
    /* 描いた線は残して、下地だけ差し替える */
    const keep = document.createElement('canvas');
    keep.width = keep.height = 256;
    keep.getContext('2d').drawImage(cv, 0, 0);
    draw.bg = b.dataset.bg;
    $$('#pfBgColors button').forEach(x => x.classList.toggle('is-on', x === b));
    wipe();
    ctx.drawImage(keep, 0, 0);
  });

  $$('[data-size]').forEach(b => b.addEventListener('click', () => {
    draw.size = Number(b.dataset.size);
    $$('[data-size]').forEach(x => x.classList.toggle('is-on', x === b));
  }));

  $('#pfEraser').addEventListener('click', () => {
    draw.erasing = !draw.erasing;
    $('#pfEraser').classList.toggle('strong', draw.erasing);
  });
  $('#pfUndo').addEventListener('click', () => {
    const last = draw.undo.pop();
    if (last) ctx.putImageData(last, 0, 0);
  });
  $('#pfWipe').addEventListener('click', () => { pushUndo(); wipe(); });

  /* 指でもマウスでも描けるように pointer で拾う */
  let drawing = false, px = 0, py = 0;
  const pos = e => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * (256 / r.width), (e.clientY - r.top) * (256 / r.height)];
  };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pushUndo();
    drawing = true;
    const p0 = pos(e); px = p0[0]; py = p0[1];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = draw.erasing ? draw.bg : draw.pen;
    ctx.lineWidth = draw.size;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + 0.01, py);
    ctx.stroke();
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p1 = pos(e);
    ctx.strokeStyle = draw.erasing ? draw.bg : draw.pen;
    ctx.lineWidth = draw.size;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
    px = p1[0]; py = p1[1];
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    cv.addEventListener(ev, () => { drawing = false; }));

  $('#pfUseDraw').addEventListener('click', () => {
    pf.image = toRoundDataURL(cv);
    pf.url = null;
    pfPaint();
    toast('アイコンにした');
  });

  /* ---------- ③ 写真 ---------- */
  const cc = $('#pfCrop');
  const cg = cc.getContext('2d');

  function paintCrop() {
    cg.clearRect(0, 0, 256, 256);
    if (!crop.img) return;
    const im = crop.img;
    const base = Math.max(256 / im.width, 256 / im.height);   /* 短いほうを枠に合わせる */
    const sc = base * crop.zoom;
    const w = im.width * sc, h = im.height * sc;
    cg.drawImage(im, (256 - w) / 2 + crop.x, (256 - h) / 2 + crop.y, w, h);
  }

  $('#pfFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        crop.img = im; crop.zoom = 1; crop.x = 0; crop.y = 0;
        $('#pfCropEmpty').hidden = true;
        $('#pfCropCtrl').hidden = false;
        $('#pfCropHint').hidden = false;
        $('#pfZoom').value = 100;
        $('#pfUsePhoto').disabled = false;
        paintCrop();
      };
      im.onerror = () => toast('この画像は読めなかった');
      im.src = fr.result;
    };
    fr.onerror = () => toast('画像を読み込めなかった');
    fr.readAsDataURL(f);
  });

  $('#pfZoom').addEventListener('input', e => {
    crop.zoom = Number(e.target.value) / 100;
    paintCrop();
  });

  cc.addEventListener('pointerdown', e => {
    if (!crop.img) return;
    cc.setPointerCapture(e.pointerId);
    crop.dragging = true; crop.lx = e.clientX; crop.ly = e.clientY;
  });
  cc.addEventListener('pointermove', e => {
    if (!crop.dragging) return;
    const r = cc.getBoundingClientRect();
    const k = 256 / r.width;
    crop.x += (e.clientX - crop.lx) * k;
    crop.y += (e.clientY - crop.ly) * k;
    crop.lx = e.clientX; crop.ly = e.clientY;
    paintCrop();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    cc.addEventListener(ev, () => { crop.dragging = false; }));

  $('#pfUsePhoto').addEventListener('click', () => {
    if (!crop.img) return;
    pf.image = toRoundDataURL(cc);
    pf.url = null;
    pfPaint();
    toast('アイコンにした');
  });
}


function openProfile() {
  const p = Profile.get();
  pf.icon   = p?.icon  || 'camellia';
  pf.color  = p?.color || Profile.COLORS[0];
  pf.image  = p?.image || null;
  pf.url    = p?.url   || null;
  pf.linked = !!p?.linked;
  $('#pfName').value = p?.name || state.account?.name || '';
  $('#pfMsg').textContent = '';

  const canGoogle = state.online && CFG.enableGoogleLogin;
  $('#pfGoogle').hidden = !canGoogle;
  if (canGoogle && state.account) {
    $('#pfGoogleBtn').querySelector('span').textContent = `${state.account.name} で紐付け済み`;
    $('#pfGoogleBtn').disabled = true;
  }

  pfPaint();
  $('#profileModal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#pfName').focus({ preventScroll: true });
}

function closeProfile() {
  $('#profileModal').hidden = true;
  if ($('#lightbox').hidden) document.body.style.overflow = '';
}

function afterProfileChange() {
  renderProfileChip();
  renderCommentForm();
  refreshWriteBoxes();
  if (state.page === 'me') renderMe();
}

function saveProfile() {
  try {
    Profile.save({ name: $('#pfName').value, icon: pf.icon, color: pf.color,
                   image: pf.image, url: pf.url, linked: pf.linked });
    afterProfileChange();
    closeProfile();
    toast('プロフィールを保存した');
  } catch (err) {
    $('#pfMsg').textContent = err.message;
  }
}

/* ============================================================
   コメントを書ける状態か
   ============================================================ */
function commentCheck() {
  if (state.site.requireLogin && !state.account) return { ok: false, why: 'google' };
  if (!Profile.get()) return { ok: false, why: 'profile' };
  return { ok: true };
}

function renderCommentForm() {
  const check = commentCheck();
  const gate = $('#commentGate');
  const form = $('#lbCommentForm');

  if (check.ok) {
    const p = Profile.get();
    gate.hidden = true;
    form.hidden = false;
    $('#commentAs').innerHTML =
      `${avatar(p, 24)}<span><b>${esc(p.name)}</b> として書き込みます</span>` +
      `<button type="button" data-open-profile>変える</button>`;
    return;
  }

  form.hidden = true;
  gate.hidden = false;
  gate.innerHTML = check.why === 'google'
    ? `<p>コメントするには、Googleでのログインが必要です。</p>
       <button type="button" data-google-login>Googleでログイン</button>`
    : `<p>コメントするには、なまえとアイコンが必要です。</p>
       <button type="button" data-open-profile>プロフィールを作る</button>`;
}

/* ============================================================
   シェア
   ============================================================ */
function linkTo(id) {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.set('w', id);
  return url.toString();
}

async function share(id) {
  const w = workById(id);
  const url = linkTo(id);

  if (navigator.share) {
    try { await navigator.share({ title: w?.title || '', url }); return; }
    catch { return; }                     /* キャンセルされただけ */
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('リンクをコピーしました');
  } catch {
    prompt('このリンクをコピーしてください', url);
  }
}

/* ============================================================
   拡大表示
   ============================================================ */
const lb = {
  root: null, img: null, stage: null,
  id: null, token: 0,
  scale: 1, tx: 0, ty: 0,
  pointers: new Map(),
  pinchStart: 0, pinchScale: 1,
  panning: false, panX: 0, panY: 0,
};

const MIN_SCALE = 1, MAX_SCALE = 8;

function lbApply() {
  lb.img.style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.scale})`;
  $('#lbZoomLabel').textContent = Math.round(lb.scale * 100) + '%';
}
function lbReset() { lb.scale = 1; lb.tx = 0; lb.ty = 0; lbApply(); }

function lbZoomTo(next, cx, cy) {
  next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  const rect = lb.stage.getBoundingClientRect();
  const px = (cx ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
  const py = (cy ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
  const k = next / lb.scale;

  lb.tx = px - (px - lb.tx) * k;
  lb.ty = py - (py - lb.ty) * k;
  lb.scale = next;
  if (lb.scale <= MIN_SCALE + 0.001) { lb.tx = 0; lb.ty = 0; }
  lbApply();
}

function lbRenderStats(id) {
  const s = statOf(id);
  $('#lbViews').textContent    = fmtCount(s.views);
  $('#lbHearts').textContent   = fmtCount(s.hearts);
  $('#lbComments').textContent = fmtCount(s.comments);

  const btn = $('#lbHeartBtn');
  const on = state.myHearts.has(id);
  btn.classList.toggle('is-on', on);
  $('.heart-txt', btn).textContent = on ? 'いいね済み' : 'いいね';
}

function paintComments(list) {
  $('#lbCommentList').innerHTML = list.length
    ? list.map(c => `
      <li>
        ${avatar(c.avatar, 30)}
        <div class="c-main">
          <div class="c-head">
            <span class="c-name">${esc(c.name || 'ななし')}${c.verified ? '<span class="c-verified" title="ログイン済み">✓</span>' : ''}</span>
            <time>${fmtDate(c.date)}</time>
          </div>
          <p class="c-text">${esc(c.text)}</p>
        </div>
      </li>`).join('')
    : '<li><span class="comment-empty">まだコメントはありません。</span></li>';
}

async function loadComments(id) {
  const token = lb.token;
  $('#lbCommentList').innerHTML = '<li><span class="comment-empty">読み込み中…</span></li>';
  try {
    const list = await api.comments(id);
    if (token !== lb.token) return;
    paintComments(list);
  } catch (err) {
    if (token !== lb.token) return;
    console.warn(err);
    $('#lbCommentList').innerHTML = '<li><span class="comment-empty">コメントを読み込めませんでした。</span></li>';
  }
}

async function openLightbox(id) {
  const w = workById(id);
  if (!w) return;
  lb.id = id;
  lb.token++;

  const a = artistOf(w.artist);
  lb.img.src = w.file;
  lb.img.alt = w.title;
  $('#lbTitle').textContent = w.title;
  $('#lbDate').textContent  = fmtDate(w.date);
  $('#lbDesc').textContent  = w.desc || '';
  const artistEl = $('#lbArtist');
  artistEl.textContent = a.name;
  artistEl.style.background = a.color;
  $('#lbTags').innerHTML = (w.tags || []).map(t => `<li>#${esc(t)}</li>`).join('');

  lbRenderStats(id);
  renderCommentForm();
  lbReset();

  lb.root.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#lbHeartBtn').focus({ preventScroll: true });

  loadComments(id);

  try {
    await api.registerView(id);
    if (lb.id === id) {
      const s = statOf(id);
      s.views += 1;
      state.stats[id] = s;
      lbRenderStats(id);
      patchPost(id);
    }
  } catch (err) { console.warn(err); }
}

function closeLightbox() {
  lb.root.hidden = true;
  lb.token++;
  lb.img.removeAttribute('src');
  if ($('#profileModal').hidden) document.body.style.overflow = '';

  /* URLに ?w= が付いていたら消しておく（file:// では効かないので握りつぶす） */
  if (new URLSearchParams(location.search).has('w')) {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('w');
      history.replaceState(null, '', url.pathname + url.search);
    } catch {}
  }
}

function stepLightbox(dir) {
  if (!state.visible.length) return;
  let i = state.visible.findIndex(w => w.id === lb.id);
  if (i < 0) i = 0;
  openLightbox(state.visible[(i + dir + state.visible.length) % state.visible.length].id);
}

async function toggleHeartFor(id, btn) {
  if (!id) return;
  if (btn) btn.disabled = true;
  try {
    const on = await api.toggleHeart(id);
    if (on) state.myHearts.add(id); else state.myHearts.delete(id);
    const s = statOf(id);
    s.hearts = Math.max(0, s.hearts + (on ? 1 : -1));
    state.stats[id] = s;

    if (!lb.root.hidden && lb.id === id) lbRenderStats(id);
    patchPost(id);
  } catch (err) {
    console.warn(err);
    toast('うまく反映できませんでした');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 拡大画面のコメント送信 */
async function submitComment(e) {
  e.preventDefault();
  const id = lb.id;
  const text = $('#cText').value.trim();
  if (!id || !text) return;
  if (!commentCheck().ok) { renderCommentForm(); return; }

  const btn = $('#lbCommentForm button[type=submit]');
  btn.disabled = true;
  try {
    await api.addComment(id, Profile.get(), text);
    $('#cText').value = '';
    bumpComment(id);
    lbRenderStats(id);
    await loadComments(id);
    fillPostComments([id]);
  } catch (err) {
    console.warn(err);
    toast('コメントを送れませんでした');
  } finally {
    btn.disabled = false;
  }
}

/** フィードの中の書き込み欄から送信 */
async function submitInline(form) {
  const id = form.dataset.write;
  const input = $('input', form);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (!commentCheck().ok) { refreshWriteBoxes(); return; }

  const btn = $('button[type=submit]', form);
  input.disabled = true; if (btn) btn.disabled = true;
  try {
    await api.addComment(id, Profile.get(), text);
    input.value = '';
    bumpComment(id);
    patchPost(id);
    await fillPostComments([id]);
    if (!lb.root.hidden && lb.id === id) { lbRenderStats(id); loadComments(id); }
  } catch (err) {
    console.warn(err);
    toast('コメントを送れませんでした');
  } finally {
    input.disabled = false; if (btn) btn.disabled = false;
  }
}

function bumpComment(id) {
  const s = statOf(id);
  s.comments += 1;
  state.stats[id] = s;
}

/* ---------- 拡大・移動の操作 ---------- */
function bindLightbox() {
  lb.root  = $('#lightbox');
  lb.img   = $('#lbImg');
  lb.stage = $('#lbStage');

  $$('[data-close]', lb.root).forEach(el => el.addEventListener('click', closeLightbox));
  $('#lbPrev').addEventListener('click', () => stepLightbox(-1));
  $('#lbNext').addEventListener('click', () => stepLightbox(1));
  $('#lbHeartBtn').addEventListener('click', () => toggleHeartFor(lb.id, $('#lbHeartBtn')));
  $('#lbShareBtn').addEventListener('click', () => share(lb.id));
  $('#lbCommentForm').addEventListener('submit', submitComment);

  $$('.lb-zoombar [data-zoom]').forEach(btn => btn.addEventListener('click', () => {
    const kind = btn.dataset.zoom;
    if (kind === 'reset') lbReset();
    else lbZoomTo(lb.scale * (kind === 'in' ? 1.4 : 1 / 1.4));
  }));

  lb.stage.addEventListener('wheel', e => {
    e.preventDefault();
    lbZoomTo(lb.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });

  lb.stage.addEventListener('dblclick', e => {
    if (lb.scale > 1.01) lbReset();
    else lbZoomTo(2.5, e.clientX, e.clientY);
  });

  lb.stage.addEventListener('pointerdown', e => {
    lb.stage.setPointerCapture(e.pointerId);
    lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (lb.pointers.size === 2) {
      const [p1, p2] = [...lb.pointers.values()];
      lb.pinchStart = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      lb.pinchScale = lb.scale;
      lb.panning = false;
    } else if (lb.scale > 1.01) {
      lb.panning = true;
      lb.panX = e.clientX - lb.tx;
      lb.panY = e.clientY - lb.ty;
      lb.stage.classList.add('is-panning');
    }
  });

  lb.stage.addEventListener('pointermove', e => {
    if (!lb.pointers.has(e.pointerId)) return;
    lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (lb.pointers.size === 2 && lb.pinchStart > 0) {
      const [p1, p2] = [...lb.pointers.values()];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      lbZoomTo(lb.pinchScale * (dist / lb.pinchStart), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    } else if (lb.panning) {
      lb.tx = e.clientX - lb.panX;
      lb.ty = e.clientY - lb.panY;
      lbApply();
    }
  });

  const endPointer = e => {
    lb.pointers.delete(e.pointerId);
    if (lb.pointers.size < 2) lb.pinchStart = 0;
    if (lb.pointers.size === 0) {
      lb.panning = false;
      lb.stage.classList.remove('is-panning');
    }
  };
  lb.stage.addEventListener('pointerup', endPointer);
  lb.stage.addEventListener('pointercancel', endPointer);

  document.addEventListener('keydown', e => {
    if (lb.root.hidden) return;
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'Escape')          closeLightbox();
    else if (e.key === 'ArrowLeft')  stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
    else if (e.key === '+' || e.key === '=') lbZoomTo(lb.scale * 1.3);
    else if (e.key === '-')          lbZoomTo(lb.scale / 1.3);
    else if (e.key === '0')          lbReset();
  });
}

/* ============================================================
   ホームに戻る
   ============================================================ */
function goHome() {
  if (!lb.root.hidden) closeLightbox();
  if (!$('#profileModal').hidden) closeProfile();
  showPage('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   もっと読み込む
   ============================================================ */
function bindInfiniteScroll() {
  const sentinel = $('#feedSentinel');
  if (!('IntersectionObserver' in window)) return;

  new IntersectionObserver(entries => {
    if (!entries.some(en => en.isIntersecting)) return;
    if (state.page !== 'home') return;
    if (state.feedShown >= state.visible.length) return;
    renderFeed(false);
  }, { rootMargin: '300px' }).observe(sentinel);
}

/* ============================================================
   イベント
   ============================================================ */
function bindUI() {
  document.addEventListener('click', e => {
    const tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) { e.preventDefault(); setTag(tagBtn.dataset.tag); return; }

    const open = e.target.closest('[data-open]');
    if (open) { openLightbox(open.dataset.open); return; }

    const heart = e.target.closest('[data-heart]');
    if (heart) { toggleHeartFor(heart.dataset.heart, heart); return; }

    const sh = e.target.closest('[data-share]');
    if (sh) { share(sh.dataset.share); return; }

    if (e.target.closest('[data-open-profile]') || e.target.closest('#profileChip')) {
      openProfile(); return;
    }

    if (e.target.closest('[data-google-login]')) {
      DB.auth.signInWithGoogle().catch(err => toast(err.message));
      return;
    }

    const nav = e.target.closest('.bottomnav [data-page]');
    if (nav) { showPage(nav.dataset.page); return; }
  });

  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-write]');
    if (!form) return;
    e.preventDefault();
    submitInline(form);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const btn = e.target.closest?.('[data-open]');
    if (!btn || btn.tagName === 'BUTTON') return;
    e.preventDefault();
    openLightbox(btn.dataset.open);
  });

  $('#topHome').addEventListener('click', goHome);
  $('#homeBtn').addEventListener('click', goHome);

  $$('.feedtab').forEach(tab => tab.addEventListener('click', () => {
    state.sort = tab.dataset.sort;
    $$('.feedtab').forEach(t => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    reRenderCurrent();
  }));

  $('#artistFilter').addEventListener('change', e => {
    state.artist = e.target.value;
    reRenderCurrent();
  });

  const homeBtn = $('#homeBtn');
  const checkScroll = () => { homeBtn.hidden = window.scrollY < 500; };
  window.addEventListener('scroll', checkScroll, { passive: true });
  checkScroll();

  /* 窓の幅が変わったら、壁の列数を取り直して組み直す */
  let lastCols = wallColumnCount();
  window.addEventListener('resize', () => {
    const now = wallColumnCount();
    if (now !== lastCols) { lastCols = now; scheduleWallLayout(); }
  }, { passive: true });
}

/* タグの一覧。使われているタグを、多い順に並べる */
function renderTagBar() {
  const count = new Map();
  for (const w of state.gallery)
    for (const t of (w.tags || [])) count.set(t, (count.get(t) || 0) + 1);

  const tags = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));

  const html = tags.length
    ? tags.map(([t, n]) =>
        `<button type="button" data-tag="${esc(t)}" class="${t === state.tag ? 'on' : ''}">#${esc(t)} <small>${n}</small></button>`
      ).join('') + (state.tag ? '<button type="button" data-tag="" class="clear">絞り込みを外す</button>' : '')
    : '';

  $$('[data-tagbar]').forEach(el => {
    el.innerHTML = html;
    el.hidden = !tags.length;
  });
}

/* タグを押したときの動き。同じタグをもう一度押すと外れる */
function setTag(t) {
  state.tag = (t && t !== state.tag) ? t : '';
  renderTagBar();
  reRenderCurrent();
  if (state.page !== 'home' && state.page !== 'wall') showPage('home');
}

function renderArtistFilter() {
  const used = [...new Set(state.gallery.map(w => w.artist))];
  $('#artistFilter').innerHTML =
    '<option value="">ぜんぶ</option>' +
    used.map(k => `<option value="${esc(k)}"${k === state.artist ? ' selected' : ''}>${esc(artistOf(k).name)}</option>`).join('');
}

function showModeNote(text) {
  const el = $('#modeNote');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

/* ============================================================
   起動
   ============================================================ */
async function boot() {
  let data = null;

  if (window.DB?.configured) {
    try {
      DB.init();
      data = await DB.api.loadAll();
      api = DB.api;
      state.online = true;
      state.account = await DB.auth.account().catch(() => null);
    } catch (err) {
      console.error('[椿HP] サーバーから読み込めませんでした:', err);
      showModeNote('サーバーにつながらないため、見本モードで表示しています。');
    }
  } else {
    showModeNote('見本モードです（config.js が未設定）。投稿もハートもコメントも、この端末の中だけに保存されます。');
  }

  if (!data) {
    api = Demo.api;
    data = await Demo.api.loadAll();
  }

  Object.assign(state, data);

  /* Googleでログインしたばかりで、まだプロフィールが無いなら作っておく */
  if (state.account && !Profile.get()) {
    try {
      Profile.save({
        name: state.account.name || 'ななし',
        icon: 'camellia', color: Profile.COLORS[0],
        url: state.account.picture, linked: true,
      });
    } catch {}
  }

  renderHeader();
  renderArtistFilter();
  renderTagBar();
  renderPickup();
  renderCommentForm();
  showPage('home');

  /* 共有リンク（?w=…）で来たら、その絵を開く */
  const wanted = new URLSearchParams(location.search).get('w');
  if (wanted && workById(wanted)) openLightbox(wanted);
}

buildProfileModal();
bindUI();
bindLightbox();
bindInfiniteScroll();
boot();
