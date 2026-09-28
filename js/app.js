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
