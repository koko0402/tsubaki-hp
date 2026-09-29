/* ============================================================
   pages.js — 壁・ブログ・わたし
   ------------------------------------------------------------
   ギャラリー（木の壁に画鋲）、ブログ、わたし、ページの切り替え。

   ※ 読み込む順番が決まっている（index.html を参照）
       core → feed → pages → profile-ui → viewer → app
   ============================================================ */
'use strict';

/* ============================================================
   絵だけ／壁
   ============================================================ */
function tileHTML(w) {
  const s = statOf(w.id);
  return `
  <button type="button" class="tile" data-open="${esc(w.id)}" aria-label="${esc(w.title)} を大きく見る">
    <img src="${esc(filesOf(w)[0] || '')}" alt="${esc(w.title)}" loading="lazy">
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
  const files = filesOf(w);
  return `
  <article class="card" data-rot="${i % 4}" data-pin="${i % 3}">
    ${pinSVG()}
    <div class="card-frame" role="button" tabindex="0" data-open="${esc(w.id)}"
         aria-label="${esc(w.title)} を大きく見る">
      ${files.length > 1 ? `<span class="card-many">${files.length}枚</span>` : ''}
      <img class="card-img" src="${esc(files[0] || '')}" alt="${esc(w.title)}" loading="lazy">
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
  /* 壁は絵を貼る場所なので、文章だけの投稿はここには出さない */
  state.visible = currentList().filter(w => !isTextPost(w));
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
  $('#meCard').innerHTML = !state.account
    ? `${avatar(null, 64)}
       <div class="me-info">
         <p class="me-name">ログインしていません</p>
         <p class="me-note">見るだけならこのままで大丈夫。いいね・コメントはログインするとできます。</p>
       </div>
       <button type="button" data-open-login>ログイン</button>`
    : p
    ? `${avatar(p, 64)}
       <div class="me-info">
         <p class="me-name">${esc(p.name)}</p>
         <p class="me-note">${esc(accountLabel())}でログイン中</p>
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
