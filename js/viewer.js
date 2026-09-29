/* ============================================================
   viewer.js — 拡大表示とシェア
   ------------------------------------------------------------
   絵を大きく見る（ホイールで拡大、ドラッグで移動）、共有リンクのコピー。

   ※ 読み込む順番が決まっている（index.html を参照）
       core → feed → pages → profile-ui → viewer → app
   ============================================================ */
'use strict';

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
  files: [], at: 0,          /* 複数枚の投稿のとき、その一覧と今何枚目か */
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

/* コメント1件分。返信は親の下にぶら下げる（段は1つだけ） */
function commentHTML(c, isReply) {
  return `
    <div class="c-item${isReply ? ' is-reply' : ''}" data-comment="${esc(c.id)}">
      ${avatar(c.avatar, isReply ? 24 : 30)}
      <div class="c-main">
        <div class="c-head">
          <span class="c-name">${esc(c.name || 'ななし')}</span>
          <time>${fmtDate(c.date)}</time>
        </div>
        <p class="c-text">${esc(c.text)}</p>
        <button type="button" class="c-reply-btn" data-reply="${esc(c.id)}" data-reply-to="${esc(c.name || 'ななし')}">返信</button>
      </div>
    </div>`;
}

/* 平らな配列を「親→その返信」に組み直す。
   返信への返信も、いちばん上の親にまとめる（段を深くしない）。 */
function threadComments(list) {
  const byId  = new Map(list.map(c => [c.id, c]));
  const roots = [];
  const kids  = new Map();

  const rootOf = c => {
    let cur = c, guard = 0;
    while (cur.parentId && byId.has(cur.parentId) && guard++ < 20) cur = byId.get(cur.parentId);
    return cur;
  };

  for (const c of list) {
    if (!c.parentId || !byId.has(c.parentId)) { roots.push(c); continue; }
    const r = rootOf(c);
    if (r === c) { roots.push(c); continue; }   /* 親をたどれなかったとき */
    if (!kids.has(r.id)) kids.set(r.id, []);
    kids.get(r.id).push(c);
  }
  return roots.map(r => ({ root: r, replies: kids.get(r.id) || [] }));
}

function paintComments(list) {
  const tree = threadComments(list);
  $('#lbCommentList').innerHTML = tree.length
    ? tree.map(({ root, replies }) => `
      <li>
        ${commentHTML(root, false)}
        ${replies.length ? `<div class="c-replies">${replies.map(r => commentHTML(r, true)).join('')}</div>` : ''}
      </li>`).join('')
    : '<li><span class="comment-empty">まだコメントはありません。</span></li>';
}

/* ---------- 返信を書く欄 ---------- */

/** 返信欄を開く。すでに開いていたら閉じる（もう一度押したら引っ込む） */
function openReplyBox(rootId, toName) {
  const item = $(`#lbCommentList [data-comment="${CSS.escape(rootId)}"]`);
  if (!item) return;

  const opened = $('#lbCommentList .c-replybox');
  const sameSpot = opened && opened.dataset.parent === rootId;
  if (opened) opened.remove();
  if (sameSpot) return;

  const check = commentCheck();
  if (!check.ok) {
    if (check.why === 'login') openLogin('返信するには');
    else { toast('なまえとアイコンを決めると返信できます'); openProfile(); }
    return;
  }

  const p = Profile.get();
  const box = document.createElement('form');
  box.className = 'c-replybox';
  box.dataset.parent = rootId;
  box.innerHTML =
    avatar(p, 24) +
    `<input type="text" maxlength="400" placeholder="${esc(toName || '')}さんに返信" aria-label="返信を書く">` +
    '<button type="submit">送信</button>' +
    '<button type="button" class="c-cancel">やめる</button>';

  /* 返信は親のすぐ下（すでに返信があるなら、その列の最後）に置く */
  const holder = item.parentElement.querySelector('.c-replies');
  if (holder) holder.appendChild(box);
  else item.parentElement.appendChild(box);

  box.querySelector('input').focus();
  box.querySelector('.c-cancel').addEventListener('click', () => box.remove());
  box.addEventListener('submit', e => { e.preventDefault(); submitReply(box); });
}

async function submitReply(box) {
  const id = lb.id;
  const parentId = box.dataset.parent;
  const input = box.querySelector('input');
  const text  = input.value.trim();
  if (!id || !text) return;
  if (!commentCheck().ok) { box.remove(); renderCommentForm(); return; }

  const btn = box.querySelector('button[type=submit]');
  input.disabled = true; btn.disabled = true;
  try {
    await api.addComment(id, Profile.get(), text, parentId);
    bumpComment(id);
    lbRenderStats(id);
    await loadComments(id);
    patchPost(id);
  } catch (err) {
    console.warn(err);
    toast(err.message || '返信を送れませんでした');
    input.disabled = false; btn.disabled = false;
  }
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

/** 何枚目を出すか決めて、絵と「2 / 3」の表示を合わせる */
function showLbImage(at) {
  const files = lb.files;

  /* 文章だけの投稿。絵の場所ごと引っ込めて、右の文章だけにする */
  lb.root.classList.toggle('is-textonly', files.length === 0);
  if (!files.length) {
    lb.img.removeAttribute('src');
    $('#lbCount').hidden = true;
    return;
  }

  lb.at = (at + files.length) % files.length;
  lb.img.src = files[lb.at];
  lbReset();

  const el = $('#lbCount');
  el.hidden = files.length < 2;
  el.textContent = `${lb.at + 1} / ${files.length}`;

  /* 矢印の説明も、中で送るのか隣の絵へ行くのかで変える */
  const inside = files.length > 1;
  $('#lbPrev').setAttribute('aria-label', inside ? '前の画像' : '前の絵');
  $('#lbNext').setAttribute('aria-label', inside ? '次の画像' : '次の絵');
}

async function openLightbox(id, at = 0) {
  const w = workById(id);
  if (!w) return;
  lb.id = id;
  lb.token++;
  lb.files = filesOf(w);

  const a = artistOf(w.artist);
  showLbImage(Number(at) || 0);
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

/* ‹ › の動き。
   複数枚の投稿なら、まずその中を送る。
   端まで行ったら、隣の投稿へ移る（そのとき最後の1枚から見せる）。 */
function stepLightbox(dir) {
  const last = lb.files.length - 1;
  if (lb.files.length > 1) {
    const next = lb.at + dir;
    if (next >= 0 && next <= last) { showLbImage(next); return; }
  }

  if (!state.visible.length) return;
  let i = state.visible.findIndex(w => w.id === lb.id);
  if (i < 0) i = 0;

  /* 文章だけの投稿は飛ばす（拡大して見るものが無いので） */
  const n = state.visible.length;
  let target = null;
  for (let step = 1; step <= n; step++) {
    const cand = state.visible[(((i + dir * step) % n) + n) % n];
    if (!isTextPost(cand)) { target = cand; break; }
  }
  if (!target) return;

  /* 左へ戻るときは、その投稿の最後の1枚から */
  const at = dir < 0 ? Math.max(0, filesOf(target).length - 1) : 0;
  openLightbox(target.id, at);
}

async function toggleHeartFor(id, btn) {
  if (!id) return;
  if (!state.account) { openLogin('いいねするには'); return; }
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
    toast(err.message || 'コメントを送れませんでした');
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
    toast(err.message || 'コメントを送れませんでした');
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

  $('#lbCommentList').addEventListener('click', e => {
    const btn = e.target.closest('[data-reply]');
    if (!btn) return;
    openReplyBox(btn.dataset.reply, btn.dataset.replyTo);
  });

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
