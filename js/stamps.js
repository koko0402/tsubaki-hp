/* ============================================================
   stamps.js — 手描きスタンプ
   ------------------------------------------------------------
   ・ホワイトボードに描いて保存 → 自分のスタンプになる（1人30個まで）
   ・書き込み欄の横のボタンから一覧を出して、押すとそのままコメントとして送る
   ・コメントに付いたスタンプの表示
   作る・使うにはログインが要る（見るだけならいらない）。

   ※ 読み込む順番が決まっている（index.html を参照）
       core → feed → pages → profile-ui → stamps → viewer → app
   ============================================================ */
'use strict';

/* 画像として出してよい形。サーバー側（schema.sql）と同じ条件 */
const STAMP_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const STAMP_MAX_CHARS = 60000;

/* ---------- 表示用の置き場（id → data URL。消されたものは null） ---------- */
const stampCache = new Map();

/** まだ手元に無いスタンプだけ取ってくる */
async function loadStamps(ids) {
  const need = [...new Set(ids)].filter(id => id && !stampCache.has(id));
  if (!need.length) return;
  try {
    const got = await api.stamps(need);
    for (const id of need) stampCache.set(id, got[id] || null);
  } catch (err) { console.warn(err); }
}

/** コメントの中身（スタンプ＋文字）。文字は esc 済みで返す */
function commentBodyHTML(c) {
  let html = '';
  if (c.stampId) {
    const d = stampCache.get(c.stampId);
    html += (d && STAMP_RE.test(d))
      ? `<img class="c-stamp" src="${esc(d)}" alt="スタンプ" loading="lazy">`
      : '<span class="c-stamp-gone">（スタンプは消されました）</span>';
  }
  if (c.text) html += `<p class="c-text">${esc(c.text)}</p>`;
  if (!c.stampId && !c.text) html += '<span class="c-stamp-gone">（スタンプは消されました）</span>';
  return html;
}


/* ============================================================
   スタンプを選ぶシート（下からせり上がる）
   ============================================================ */
const sheet = { workId: null, parentId: null, editing: false, sending: false };

/** workId の作品に（parentId があればその返信として）スタンプを送るためのシートを開く */
async function openStampSheet(workId, parentId = null) {
  const check = commentCheck();
  if (!check.ok) {
    if (check.why === 'login') openLogin('スタンプを使うには');
    else { toast('なまえとアイコンを決めるとスタンプを使えます'); openProfile(); }
    return;
  }
  sheet.workId = workId;
  sheet.parentId = parentId;
  sheet.editing = false;
  $('#stampSheet').hidden = false;
  paintStampSheet(true);
  try {
    state.myStamps = await api.myStamps();
  } catch (err) {
    console.warn(err);
    state.myStamps = [];
  }
  paintStampSheet(false);
}

function closeStampSheet() {
  $('#stampSheet').hidden = true;
}

function paintStampSheet(loading) {
  const list = state.myStamps || [];
  $('#stampEdit').hidden = !list.length;
  $('#stampEdit').textContent = sheet.editing ? 'おわる' : '消す';
  $('#stampCount').textContent = loading ? '' : `${list.length} / 30`;

  const grid = $('#stampGrid');
  grid.classList.toggle('is-editing', sheet.editing);
  grid.innerHTML =
    `<button type="button" class="stamp-new" data-stamp-new>
       <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>
       <span>描く</span>
     </button>` +
    (loading ? '<p class="stamp-note">読み込み中…</p>' :
      list.map(s => STAMP_RE.test(s.data) ? `
        <button type="button" class="stamp-tile" data-stamp-id="${esc(s.id)}"
                aria-label="${sheet.editing ? 'このスタンプを消す' : 'このスタンプを送る'}">
          <img src="${esc(s.data)}" alt="">
          ${sheet.editing ? '<i class="stamp-del" aria-hidden="true">×</i>' : ''}
        </button>` : '').join('')) +
    (!loading && !list.length
      ? '<p class="stamp-note">まだスタンプがありません。「描く」から作ると、ここに並びます。</p>' : '');
}

async function sendStamp(stampId) {
  if (sheet.sending) return;
  const id = sheet.workId;
  const parentId = sheet.parentId;
  sheet.sending = true;
  try {
    await api.addComment(id, Profile.get(), '', parentId, stampId);
    closeStampSheet();
    toast('スタンプを送った');
    await afterCommentSent(id);
    $('#lbCommentList .c-replybox')?.remove();
  } catch (err) {
    console.warn(err);
    toast(err.message || 'スタンプを送れませんでした');
  } finally {
    sheet.sending = false;
  }
}

async function removeStamp(stampId) {
  if (!confirm('このスタンプを消します。これまでのコメントに付いていたものも消えます。よろしいですか？')) return;
  try {
    await api.deleteStamp(stampId);
    state.myStamps = (state.myStamps || []).filter(s => s.id !== stampId);
    stampCache.set(stampId, null);
    paintStampSheet(false);
    toast('スタンプを消した');
  } catch (err) {
    toast(err.message || '消せませんでした');
  }
}


/* ============================================================
   ホワイトボード（スタンプを描く）
   ------------------------------------------------------------
   256x256 で描いて、保存するときに小さくして data URL にする。
   背景は透明（コメント欄の色がそのまま透ける）。見やすいように
   ボードは白く見せているけれど、白は絵には入らない。
   ============================================================ */
const STAMP_PENS = ['#2b2018', '#c62b3d', '#e0783c', '#e8b84b', '#3f6b46',
                    '#3d7ea6', '#7a5ba8', '#d9639a', '#8a6a4a', '#ffffff'];
const board = { pen: STAMP_PENS[0], size: 8, erasing: false, undo: [], drawn: false };

function buildStampBoard() {
  const cv = $('#sbCanvas');
  const ctx = cv.getContext('2d');

  $('#sbPens').innerHTML = STAMP_PENS.map((c, i) =>
    `<button type="button" data-sb-pen="${c}" class="${i === 0 ? 'is-on' : ''}" style="background:${c}" aria-label="ペンの色 ${c}"></button>`).join('');

  $('#sbPens').addEventListener('click', e => {
    const b = e.target.closest('[data-sb-pen]'); if (!b) return;
    board.pen = b.dataset.sbPen; board.erasing = false;
    $$('#sbPens button').forEach(x => x.classList.toggle('is-on', x === b));
    $('#sbEraser').classList.remove('is-on');
  });
  $$('[data-sb-size]').forEach(b => b.addEventListener('click', () => {
    board.size = Number(b.dataset.sbSize);
    $$('[data-sb-size]').forEach(x => x.classList.toggle('is-on', x === b));
  }));
  $('#sbEraser').addEventListener('click', () => {
    board.erasing = !board.erasing;
    $('#sbEraser').classList.toggle('is-on', board.erasing);
  });

  const pushUndo = () => {
    board.undo.push(ctx.getImageData(0, 0, 256, 256));
    if (board.undo.length > 20) board.undo.shift();
  };
  $('#sbUndo').addEventListener('click', () => {
    const last = board.undo.pop();
    if (last) ctx.putImageData(last, 0, 0);
  });
  $('#sbWipe').addEventListener('click', () => {
    pushUndo();
    ctx.clearRect(0, 0, 256, 256);
  });

  /* 指でもマウスでもペンでも描けるように pointer で拾う */
  let drawing = false, px = 0, py = 0;
  const pos = e => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * (256 / r.width), (e.clientY - r.top) * (256 / r.height)];
  };
  const stroke = (x0, y0, x1, y1) => {
    ctx.globalCompositeOperation = board.erasing ? 'destination-out' : 'source-over';
    ctx.strokeStyle = board.pen;
    ctx.lineWidth = board.erasing ? board.size * 2.2 : board.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    pushUndo();
    drawing = true;
    board.drawn = true;
    [px, py] = pos(e);
    stroke(px, py, px + 0.01, py);
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return;
    const [x, y] = pos(e);
    stroke(px, py, x, y);
    px = x; py = y;
  });
  ['pointerup', 'pointercancel'].forEach(ev => cv.addEventListener(ev, () => { drawing = false; }));

  $$('[data-sbclose]').forEach(el => el.addEventListener('click', closeStampBoard));
  $('#sbSave').addEventListener('click', saveStampFromBoard);
}

function openStampBoard() {
  const ctx = $('#sbCanvas').getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  board.undo = [];
  board.drawn = false;
  board.erasing = false;
  $('#sbEraser').classList.remove('is-on');
  $('#sbMsg').textContent = '';
  $('#stampBoard').hidden = false;
}

function closeStampBoard() {
  $('#stampBoard').hidden = true;
}

/** 何も描いていないか（全部透明か） */
function boardIsEmpty() {
  const px = $('#sbCanvas').getContext('2d').getImageData(0, 0, 256, 256).data;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) return false;
  return true;
}

/** 小さくして data URL に。WebP が使えればそれ、だめなら PNG（iPhone は PNG になる） */
function stampDataURL(size) {
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage($('#sbCanvas'), 0, 0, size, size);
  const webp = out.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png');
}

async function saveStampFromBoard() {
  const msg = $('#sbMsg');
  if (boardIsEmpty()) { msg.textContent = '何か描いてから保存して'; return; }

  /* 大きすぎたら、もう一回り小さくして試す */
  let data = null;
  for (const size of [160, 128, 96]) {
    const d = stampDataURL(size);
    if (d.length <= STAMP_MAX_CHARS) { data = d; break; }
  }
  if (!data) { msg.textContent = '線が細かすぎて保存できなかった。少し消してから試して'; return; }

  const btn = $('#sbSave');
  btn.disabled = true;
  try {
    const id = await api.createStamp(data);
    stampCache.set(id, data);
    state.myStamps = [{ id, data }, ...(state.myStamps || [])];
    closeStampBoard();
    paintStampSheet(false);
    toast('スタンプにした。押すと送れる');
  } catch (err) {
    msg.textContent = err.message || '保存できませんでした';
  } finally {
    btn.disabled = false;
  }
}


/* ============================================================
   イベント
   ============================================================ */
function bindStamps() {
  buildStampBoard();

  $$('[data-sheetclose]').forEach(el => el.addEventListener('click', closeStampSheet));
  $('#stampEdit').addEventListener('click', () => {
    sheet.editing = !sheet.editing;
    paintStampSheet(false);
  });

  $('#stampGrid').addEventListener('click', e => {
    if (e.target.closest('[data-stamp-new]')) { openStampBoard(); return; }
    const tile = e.target.closest('[data-stamp-id]');
    if (!tile) return;
    if (sheet.editing) removeStamp(tile.dataset.stampId);
    else sendStamp(tile.dataset.stampId);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#stampBoard').hidden) { closeStampBoard(); e.stopImmediatePropagation(); }
    else if (!$('#stampSheet').hidden) { closeStampSheet(); e.stopImmediatePropagation(); }
  }, true);
}
