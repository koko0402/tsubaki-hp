/* ============================================================
   app.js — 起動とイベント
   ------------------------------------------------------------
   スクロール、もっと読み込む、クリックやキー操作の受け口、起動処理。
   いちばん最後に読む。

   ※ 読み込む順番が決まっている（index.html を参照）
       core → feed → pages → profile-ui → viewer → app
   ============================================================ */
'use strict';

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
   フィードの絵のタップ
   ------------------------------------------------------------
   1回なら拡大表示。すぐにもう1回なら、いいね（外すことはしない）。
   1回か2回かを見分けるために、1回目は少しだけ待ってから開く。
   ============================================================ */
const DOUBLE_TAP_MS = 260;
let tapWait = null;

function tapFeedImage(img) {
  const id = img.dataset.open;
  if (tapWait && tapWait.id === id) {
    clearTimeout(tapWait.timer);
    tapWait = null;
    likeByDoubleTap(id, img.closest('.post-media'));
    return;
  }
  if (tapWait) clearTimeout(tapWait.timer);
  const at = Number(img.dataset.at) || 0;
  tapWait = {
    id,
    timer: setTimeout(() => { tapWait = null; openLightbox(id, at); }, DOUBLE_TAP_MS),
  };
}

function likeByDoubleTap(id, media) {
  if (!state.account) { openLogin('いいねするには'); return; }

  const pop = document.createElement('span');
  pop.className = 'pop-heart';
  pop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.8 4 13a4.9 4.9 0 0 1 7-6.9l1 1 1-1a4.9 4.9 0 0 1 7 6.9z"/></svg>';
  media.appendChild(pop);
  setTimeout(() => pop.remove(), 900);

  if (!state.myHearts.has(id)) {
    toggleHeartFor(id, $(`.post[data-work="${CSS.escape(id)}"] [data-heart]`));
  }
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
  /* ---- 複数枚の投稿を横に送る ---- */
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-slide]');
    if (!nav) return;
    e.preventDefault();
    const box = nav.closest('[data-carousel]');
    const rail = box.querySelector('.rail');
    rail.scrollBy({ left: rail.clientWidth * Number(nav.dataset.slide), behavior: 'smooth' });
  });

  /* 送ったら、丸と枚数の表示を合わせる */
  document.addEventListener('scroll', e => {
    const rail = e.target;
    if (!rail.classList || !rail.classList.contains('rail')) return;
    const box = rail.closest('[data-carousel]');
    if (!box) return;
    const at = Math.round(rail.scrollLeft / Math.max(1, rail.clientWidth));
    box.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === at));
    const lab = box.querySelector('[data-at-label]');
    if (lab) lab.textContent = String(at + 1);
  }, true);

  document.addEventListener('click', e => {
    const tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) { e.preventDefault(); setTag(tagBtn.dataset.tag); return; }

    const toComments = e.target.closest('[data-open-comments]');
    if (toComments) { openLightbox(toComments.dataset.openComments, 0, { toComments: true }); return; }

    const open = e.target.closest('[data-open]');
    if (open) {
      /* フィードの絵は、1回タップで拡大、2回タップでいいね */
      if (open.tagName === 'IMG' && open.closest('.post-media')) { tapFeedImage(open); return; }
      openLightbox(open.dataset.open, Number(open.dataset.at) || 0);
      return;
    }

    const heart = e.target.closest('[data-heart]');
    if (heart) { toggleHeartFor(heart.dataset.heart, heart); return; }

    const sh = e.target.closest('[data-share]');
    if (sh) { share(sh.dataset.share); return; }

    const needLogin = e.target.closest('[data-open-login]');
    if (needLogin) { openLogin(needLogin.dataset.openLogin); return; }

    if (e.target.closest('[data-logout]')) { logout(); return; }

    /* 上のバーの丸。ログインしていなければログイン、していればプロフィール */
    if (e.target.closest('#profileChip')) {
      if (state.account) openProfile(); else openLogin();
      return;
    }

    if (e.target.closest('[data-open-profile]')) { openProfile(); return; }

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
    openLightbox(btn.dataset.open, Number(btn.dataset.at) || 0);   /* キーボードは待たずにすぐ開く */
  });

  /* ブラウザの「ダブルタップで拡大」がフィードの絵で起きないように */
  document.addEventListener('dblclick', e => {
    if (e.target.closest?.('.post-media img')) e.preventDefault();
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
      authApi = DB.auth;
      state.online = true;
    } catch (err) {
      console.error('[椿HP] サーバーから読み込めませんでした:', err);
      showModeNote('サーバーにつながらないため、見本モードで表示しています。');
    }
  } else {
    showModeNote('見本モードです（config.js が未設定）。投稿もハートもコメントも、この端末の中だけに保存されます。');
  }

  if (!data) {
    api = Demo.api;
    authApi = Demo.auth;
    data = await Demo.api.loadAll();
  }

  Object.assign(state, data);
  state.account = await authApi.account().catch(() => null);

  /* ログインしたばかりで、まだプロフィールが無いなら作っておく */
  ensureProfile();

  applyLook();          /* 色・ページの出し分け・自分で足したCSS */
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
