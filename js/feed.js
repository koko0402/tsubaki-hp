/* ============================================================
   feed.js — ヘッダーとフィード
   ------------------------------------------------------------
   上のバー、製作者のおすすめ、VOOM風の縦に流れるフィード。

   ※ 読み込む順番が決まっている（index.html を参照）
       core → feed → pages → profile-ui → viewer → app
   ============================================================ */
'use strict';

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
  if (!state.account) {
    chip.className = 'topbar-profile is-empty';
    chip.innerHTML = '<span>ログイン</span>';
    chip.title = 'いいね・コメントするにはログイン';
  } else if (p) {
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
  const picks = (state.pickup.workIds || []).map(workById).filter(w => w && !isTextPost(w));
  const hasVideo = !!state.pickup.youtubeId;

  $('#pickup').hidden = picks.length === 0 && !hasVideo;
  $('#pickupMessage').textContent = state.pickup.message || '';

  $('#pickupRail').innerHTML = picks.map(w => {
    const s = statOf(w.id);
    return `
    <button type="button" class="strip-card" data-open="${esc(w.id)}">
      <img src="${esc(filesOf(w)[0] || '')}" alt="${esc(w.title)}" loading="lazy">
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
    const label = check.why === 'login'
      ? 'ログインするとコメントできます'
      : 'コメントするにはプロフィールが必要です';
    const attr  = check.why === 'login' ? 'data-open-login="コメントするには"' : 'data-open-profile';
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

    ${mediaHTML(w)}

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
      <button type="button" data-open-comments="${esc(w.id)}">
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

/** 投稿の画像。1枚ならそのまま、複数枚なら横に送れるカルーセルにする。
    画像が無ければ何も出さない（文章だけの投稿） */
function mediaHTML(w) {
  const files = filesOf(w);
  if (!files.length) return '';

  if (files.length === 1) {
    return `
    <div class="post-media">
      <img src="${esc(files[0])}" alt="${esc(w.title)}" loading="lazy"
           role="button" tabindex="0" data-open="${esc(w.id)}">
    </div>`;
  }

  const slides = files.map((f, i) => `
    <div class="slide">
      <img src="${esc(f)}" alt="${esc(w.title)} ${i + 1}枚目" loading="lazy"
           role="button" tabindex="0" data-open="${esc(w.id)}" data-at="${i}">
    </div>`).join('');

  const dots = files.map((_, i) =>
    `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');

  return `
  <div class="post-media multi" data-carousel>
    <div class="rail">${slides}</div>
    <button type="button" class="nav prev" data-slide="-1" aria-label="前の絵">‹</button>
    <button type="button" class="nav next" data-slide="1"  aria-label="次の絵">›</button>
    <span class="count"><b data-at-label>1</b>/${files.length}</span>
    <div class="dots">${dots}</div>
  </div>`;
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
            <span class="c-name">${esc(c.name || 'ななし')}</span>
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
