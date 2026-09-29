/* ============================================================
   profile-ui.js — プロフィール画面
   ------------------------------------------------------------
   なまえとアイコンの画面。アイコンを描く／写真から作る部分もここ。
   保存のしかたそのものは js/profile.js が持っている。

   ※ 読み込む順番が決まっている（index.html を参照）
       core → feed → pages → profile-ui → viewer → app
   ============================================================ */
'use strict';

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

  /* Google でログインしている人だけ、Google の写真をアイコンにできる */
  $('#pfGoogleBtn').addEventListener('click', () => {
    if (!state.account?.picture) return;
    pf.url = state.account.picture; pf.image = null; pf.linked = true;
    pfPaint();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#loginModal').hidden) closeLogin();
    else if (!$('#profileModal').hidden) closeProfile();
  });

  buildLoginModal();

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

  $('#pfGoogle').hidden = !state.account?.picture;
  $('#pfAccount').hidden = !state.account;
  $('#pfAccountText').textContent = state.account ? `${accountLabel()}でログイン中` : '';

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
   ログイン
   ------------------------------------------------------------
   見るだけならログインはいらない。いいね・コメントはログインが要る。
   本番は Google、見本モードは「見本ユーザー」でログインしたことにする。
   ============================================================ */
function accountLabel() {
  if (!state.account) return '';
  return state.online ? (state.account.email || state.account.name || 'Google') : '見本ユーザー';
}

function buildLoginModal() {
  $$('[data-loginclose]').forEach(el => el.addEventListener('click', closeLogin));

  $('#loginGoogle').addEventListener('click', async () => {
    $('#loginMsg').textContent = '';
    try { await DB.auth.signInWithGoogle(); }   /* Google の画面へ移って、戻ってきたら起動し直す */
    catch (err) { $('#loginMsg').textContent = err.message; }
  });

  $('#loginDemo').addEventListener('click', async () => {
    await Demo.auth.signIn();
    closeLogin();
    await afterAuthChange();
    toast('ログインした');
  });
}

/** why: どうしてログインが要るのかを一言（「いいねするには」など） */
function openLogin(why) {
  $('#loginLead').innerHTML = why
    ? `${esc(why)}、ログインが必要です。<br>見るだけなら、ログインはいりません。`
    : '見るだけなら、ログインはいりません。<br>いいね・コメントは、ログインするとできます。';
  $('#loginMsg').textContent = '';
  $('#loginGoogle').hidden   = !state.online;
  $('#loginDemo').hidden     = state.online;
  $('#loginDemoNote').hidden = state.online;
  $('#loginModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLogin() {
  $('#loginModal').hidden = true;
  if ($('#lightbox').hidden && $('#profileModal').hidden) document.body.style.overflow = '';
}

async function logout() {
  if (!confirm('ログアウトします。よろしいですか？')) return;
  await authApi.signOut();
  closeProfile();
  await afterAuthChange();
  toast('ログアウトした');
}

/** ログインしたのにプロフィールが無ければ、アカウントの名前で作っておく */
function ensureProfile() {
  if (!state.account || Profile.get()) return;
  try {
    Profile.save({
      name: state.account.name || 'ななし',
      icon: 'camellia', color: Profile.COLORS[0],
      url: state.account.picture, linked: !!state.account.picture,
    });
  } catch {}
}

/** ログイン／ログアウトのあと、自分が押したハートと画面を合わせ直す */
async function afterAuthChange() {
  state.account = await authApi.account().catch(() => null);
  ensureProfile();
  try {
    const data = await api.loadAll();
    state.myHearts = data.myHearts;
    state.stats = data.stats;
  } catch (err) { console.warn(err); }

  renderProfileChip();
  renderCommentForm();
  refreshWriteBoxes();
  reRenderCurrent();
  if (!lb.root.hidden && lb.id) lbRenderStats(lb.id);
}

/* ============================================================
   コメントを書ける状態か
   ============================================================ */
function commentCheck() {
  if (!state.account) return { ok: false, why: 'login' };
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
  gate.innerHTML = check.why === 'login'
    ? `<p>コメントするには、ログインが必要です。</p>
       <button type="button" data-open-login="コメントするには">ログインする</button>`
    : `<p>コメントするには、なまえとアイコンが必要です。</p>
       <button type="button" data-open-profile>プロフィールを作る</button>`;
}
