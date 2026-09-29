/* 椿HP の操作性まわり（ダブルタップでいいね・スワイプ・コメント欄）を、スマホの幅とタッチで確かめる。
   使い方: node tests/ui_touch_test.js <椿HPのフォルダ> <スクショの出力先フォルダ> */
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class S {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map(); this.l = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) {
        const { res, rej } = this.p.get(m.id); this.p.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) (this.l.get(m.method) || []).forEach(f => f(m.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.p.set(id, { res, rej });
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
    });
  }
  on(m, f) { if (!this.l.has(m)) this.l.set(m, []); this.l.get(m).push(f); }
}

async function main() {
  const [site, outDir] = process.argv.slice(2);
  const port = 9343;
  const dir = path.join(os.tmpdir(), 'tsubaki_ui_' + Date.now());
  const br = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + port, '--user-data-dir=' + dir, 'about:blank'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    await sleep(300);
    try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch (_) {}
  }
  if (!t) { br.kill(); throw new Error('Edge が起動しない'); }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const s = new S(ws);

  const errors = [];
  s.on('Runtime.exceptionThrown', p => errors.push('例外: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
  s.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push('console.error: ' + p.args.map(a => a.value ?? a.description).join(' ')); });
  await s.send('Page.enable'); await s.send('Runtime.enable');
  /* スマホの幅で見る */
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const ev = async expr => {
    const r = await s.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async name => {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64'));
  };

  await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });
  s.on('Page.javascriptDialogOpening', () => s.send('Page.handleJavaScriptDialog', { accept: true }));

  /* 指でなぞる。points: [[x,y], ...] を順番にたどる */
  const touchPath = async (points, stepMs = 16) => {
    const [x0, y0] = points[0];
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (const [x, y] of points.slice(1)) {
      await sleep(stepMs);
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const line = (x0, y0, x1, y1, n = 10) =>
    Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
  const tap = async (x, y) => touchPath([[x, y]]);
  const centerOf = async sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
                                           return [r.left + r.width / 2, r.top + r.height / 2]; })()`);

  const url = 'file:///' + path.resolve(site, 'index.html').split(path.sep).join('/');
  await s.send('Page.navigate', { url });
  await sleep(2500);
  await ev(`Demo.auth.signIn().then(() => afterAuthChange()).then(() => 1)`);
  await sleep(800);

  /* タグは1行で横に流れる */
  check('スマホではタグが1行（折り返さない）',
    (await ev(`getComputedStyle(document.querySelector('[data-tagbar]')).flexWrap`)) === 'nowrap');

  /* フィードの絵を表示位置まで送る */
  const wid = await ev(`(() => { document.documentElement.style.scrollBehavior = 'auto';
    const p = [...document.querySelectorAll('.post')].find(x => x.querySelector('.post-media') && !state.myHearts.has(x.dataset.work));
    window.scrollTo(0, p.getBoundingClientRect().top + window.scrollY - 60); return p.dataset.work; })()`);
  await sleep(500);
  const imgSel = `.post[data-work="${wid}"] .post-media img`;

  /* ダブルタップでいいね */
  const [ix, iy] = await centerOf(imgSel);
  await tap(ix, iy); await sleep(90); await tap(ix, iy);
  await sleep(250);
  check('ダブルタップでハートが絵の上に出る', (await ev(`!!document.querySelector('.pop-heart')`)) === true);
  await sleep(700);
  check('ダブルタップでいいねが付く', (await ev(`state.myHearts.has(${JSON.stringify(wid)})`)) === true);
  check('ダブルタップでは拡大表示が開かない', (await ev(`document.querySelector('#lightbox').hidden`)) === true);
  await shot('t1-ダブルタップ');

  /* もう一度ダブルタップしても、いいねは外れない */
  await tap(ix, iy); await sleep(90); await tap(ix, iy);
  await sleep(900);
  check('2回目のダブルタップでもいいねは外れない', (await ev(`state.myHearts.has(${JSON.stringify(wid)})`)) === true);

  /* 1回タップで拡大表示 */
  await tap(ix, iy);
  await sleep(700);
  check('1回タップで拡大表示が開く', (await ev(`!document.querySelector('#lightbox').hidden`)) === true);
  check('書き込み欄が下に貼り付いている',
    (await ev(`getComputedStyle(document.querySelector('#lbCommentForm')).position`)) === 'sticky');
  check('書き込み欄が画面の中に見えている',
    (await ev(`(() => { const r = document.querySelector('#lbCommentForm').getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top < innerHeight; })()`)) === true);
  check('「リセット」が縦に折れていない',
    (await ev(`(() => { const b = document.querySelector('[data-zoom=reset]'); return b.getBoundingClientRect().height < 50; })()`)) === true);
  await shot('t2-拡大表示');

  /* 横に払うと隣の絵へ */
  const before = await ev(`lb.id + ':' + lb.at`);
  const [sx, sy] = await centerOf('#lbStage');
  await touchPath(line(sx + 120, sy, sx - 120, sy, 8));
  await sleep(700);
  check('横に払うと次の絵に進む', (await ev(`lb.id + ':' + lb.at`)) !== before, before);

  /* 下に引くと閉じる */
  await touchPath(line(sx, sy - 60, sx, sy + 200, 12));
  await sleep(600);
  check('下に引くと拡大表示が閉じる', (await ev(`document.querySelector('#lightbox').hidden`)) === true);

  /* 少しだけ下に引いたときは閉じない */
  await ev(`openLightbox(${JSON.stringify(wid)}); 1`);
  await sleep(700);
  await touchPath(line(sx, sy, sx, sy + 50, 6));
  await sleep(500);
  check('少し引いただけなら閉じない', (await ev(`!document.querySelector('#lightbox').hidden`)) === true);
  check('引いた絵が元の位置に戻る', (await ev(`lb.img.style.opacity === '' && !lb.img.style.transform.includes('translateY')`)) === true);
  await ev(`closeLightbox(); 1`);
  await sleep(300);

  /* 「コメント」ボタンでコメント欄まで送られる */
  await ev(`document.querySelector('.post[data-work="${wid}"] [data-open-comments]').click(); 1`);
  await sleep(900);
  check('「コメント」ボタンで拡大表示が開く', (await ev(`!document.querySelector('#lightbox').hidden`)) === true);
  check('開いたときコメント欄の見出しが見えている',
    (await ev(`(() => { const side = document.querySelector('.lb-side'); const h = side.querySelector('.lb-subhead').getBoundingClientRect(); const r = side.getBoundingClientRect(); return h.top >= r.top - 1 && h.top < r.bottom; })()`)) === true);
  await shot('t3-コメントへ');

  check('JavaScript のエラーが出ていない', errors.length === 0, errors.join(' / '));

  ws.close(); br.kill(); await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  for (const r of results) console.log((r.ok ? 'OK  ' : 'NG  ') + r.name + (!r.ok && r.detail ? '  … ' + r.detail : ''));
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} 通過`);
}
main().catch(e => { console.error(e); process.exit(1); });
