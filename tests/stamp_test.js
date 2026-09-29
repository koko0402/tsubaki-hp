/* 手描きスタンプ：ホワイトボードで描く → 保存 → コメントで送る → 表示 → 返信 → 消す を実際に操作して確かめる。
   使い方: node tests/stamp_test.js <椿HPのフォルダ> <スクショの出力先フォルダ> */
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
  const port = 9345;
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

  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });
  s.on('Page.javascriptDialogOpening', () => s.send('Page.handleJavaScriptDialog', { accept: true }));

  const rectOf = sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
                                     return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  /* マウスで線を引く */
  const drag = async pts => {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0][0], y: pts[0][1] });
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) {
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    }
    const [lx, ly] = pts[pts.length - 1];
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: lx, y: ly, button: 'left', clickCount: 1 });
  };
  const alphaAt = (x, y) => ev(`document.querySelector('#sbCanvas').getContext('2d').getImageData(${x}, ${y}, 1, 1).data[3]`);

  const url = 'file:///' + path.resolve(site, 'index.html').split(path.sep).join('/');
  await s.send('Page.navigate', { url });
  await sleep(2500);

  /* ログインしていないと、スタンプは使えない */
  const wid = await ev(`document.querySelector('.post').dataset.work`);
  await ev(`openStampSheet(${JSON.stringify(wid)}); 1`);
  await sleep(400);
  check('未ログインでスタンプ → ログイン画面が出る', (await ev(`!document.querySelector('#loginModal').hidden`)) === true);
  check('未ログインではシートは開かない', (await ev(`document.querySelector('#stampSheet').hidden`)) === true);
  await ev(`closeLogin(); 1`);

  await ev(`Demo.auth.signIn().then(() => afterAuthChange()).then(() => 1)`);
  await sleep(800);
  check('ログイン後、フィードの書き込み欄にスタンプボタンがある',
    (await ev(`!!document.querySelector('.post-write [data-stamp-for]')`)) === true);

  /* シートを開く */
  await ev(`document.querySelector('.post[data-work="${wid}"] [data-stamp-for]').click(); 1`);
  await sleep(700);
  check('スタンプのシートが開く', (await ev(`!document.querySelector('#stampSheet').hidden`)) === true);
  check('最初は「まだスタンプがありません」', (await ev(`document.querySelector('#stampGrid').textContent`)).includes('まだスタンプがありません'));
  await shot('s1-シート(空)');

  /* ホワイトボードを開いて、何も描かずに保存 → 止められる */
  await ev(`document.querySelector('[data-stamp-new]').click(); 1`);
  await sleep(400);
  check('「描く」でホワイトボードが開く', (await ev(`!document.querySelector('#stampBoard').hidden`)) === true);
  await ev(`document.querySelector('#sbSave').click(); 1`);
  await sleep(300);
  check('何も描かずに保存すると止められる', (await ev(`document.querySelector('#sbMsg').textContent`)).includes('何か描いて'));

  /* マウスで描く：赤い太線で丸、黒で口 */
  const b = await rectOf('#sbCanvas');
  await ev(`document.querySelector('[data-sb-pen="#c62b3d"]').click(); document.querySelector('[data-sb-size="16"]').click(); 1`);
  const circle = Array.from({ length: 25 }, (_, i) => {
    const a = i / 24 * Math.PI * 2;
    return [b.x + b.w / 2 + Math.cos(a) * b.w * .3, b.y + b.h / 2 + Math.sin(a) * b.h * .3];
  });
  await drag(circle);
  await ev(`document.querySelector('[data-sb-pen="#2b2018"]').click(); document.querySelector('[data-sb-size="8"]').click(); 1`);
  await drag([[b.x + b.w * .35, b.y + b.h * .5], [b.x + b.w * .5, b.y + b.h * .5], [b.x + b.w * .65, b.y + b.h * .5]]);
  check('描くと線が入る', (await ev(`!boardIsEmpty()`)) === true);
  const before = await alphaAt(128, 128);
  check('真ん中の線が描けている', before > 0, 'alpha=' + before);

  /* 消しゴムで真ん中を消す → 透明になる。「ひとつ戻す」で戻る */
  await ev(`document.querySelector('#sbEraser').click(); 1`);
  await drag([[b.x + b.w * .3, b.y + b.h * .5], [b.x + b.w * .7, b.y + b.h * .5]]);
  check('消しゴムで消したところは透明になる', (await alphaAt(128, 128)) === 0);
  check('描いていない角は透明のまま', (await alphaAt(2, 2)) === 0);
  await ev(`document.querySelector('#sbUndo').click(); 1`);
  check('「ひとつ戻す」で消しゴムの前に戻る', (await alphaAt(128, 128)) > 0);
  await ev(`document.querySelector('#sbEraser').click(); 1`);
  await shot('s2-ホワイトボード');

  await ev(`document.querySelector('#sbSave').click(); 1`);
  await sleep(900);
  check('保存するとホワイトボードが閉じる', (await ev(`document.querySelector('#stampBoard').hidden`)) === true);
  check('シートにスタンプが1つ並ぶ', (await ev(`document.querySelectorAll('#stampGrid [data-stamp-id]').length`)) === 1);
  const saved = await ev(`state.myStamps[0].data`);
  check('保存されたのは PNG か WebP の画像', /^data:image\/(png|webp);base64,/.test(saved));
  check('大きさが上限(6万文字)以内', saved.length <= 60000, String(saved.length));
  await shot('s3-シート(1つ)');

  /* 押すと送られる */
  await ev(`document.querySelector('#stampGrid [data-stamp-id]').click(); 1`);
  await sleep(1500);
  check('スタンプを押すとシートが閉じる', (await ev(`document.querySelector('#stampSheet').hidden`)) === true);
  check('フィードのコメントにスタンプの絵が出る',
    (await ev(`!!document.querySelector('.post[data-work="${wid}"] .post-comments img.c-stamp')`)) === true);
  await ev(`(() => { document.documentElement.style.scrollBehavior = 'auto'; const p = document.querySelector('.post[data-work="${wid}"] .post-comments'); window.scrollTo(0, p.getBoundingClientRect().top + scrollY - 300); return 1; })()`);
  await sleep(400);
  await shot('s4-フィードのスタンプ');

  /* 拡大表示の中でも見える・返信にスタンプ */
  await ev(`openLightbox(${JSON.stringify(wid)}, 0, { toComments: true }); 1`);
  await sleep(1300);
  check('拡大表示のコメント欄にもスタンプが出る', (await ev(`!!document.querySelector('#lbCommentList img.c-stamp')`)) === true);
  await ev(`document.querySelector('#lbCommentList [data-reply]').click(); 1`);
  await sleep(300);
  check('返信欄にもスタンプボタンがある', (await ev(`!!document.querySelector('.c-replybox [data-stamp-for]')`)) === true);
  await ev(`document.querySelector('.c-replybox [data-stamp-for]').click(); 1`);
  await sleep(700);
  await ev(`document.querySelector('#stampGrid [data-stamp-id]').click(); 1`);
  await sleep(1500);
  check('返信としてスタンプを送れる',
    (await ev(`!!document.querySelector('#lbCommentList .c-replies img.c-stamp')`)) === true);
  check('拡大表示の書き込み欄にもスタンプボタンがある', (await ev(`!!document.querySelector('#lbStampBtn')`)) === true);
  await shot('s5-拡大表示のスタンプ');
  await ev(`closeLightbox(); 1`);

  /* 消す */
  await ev(`openStampSheet(${JSON.stringify(wid)}); 1`);
  await sleep(700);
  await ev(`document.querySelector('#stampEdit').click(); 1`);
  await sleep(200);
  check('「消す」を押すと×が出る', (await ev(`!!document.querySelector('#stampGrid .stamp-del')`)) === true);
  await ev(`document.querySelector('#stampGrid [data-stamp-id]').click(); 1`);
  await sleep(1000);
  check('スタンプが消える', (await ev(`document.querySelectorAll('#stampGrid [data-stamp-id]').length`)) === 0);
  await ev(`closeStampSheet(); 1`);
  await ev(`fillPostComments([${JSON.stringify(wid)}]).then(() => 1)`);
  await sleep(600);
  check('消したスタンプのコメントは「消されました」になる',
    (await ev(`document.querySelector('.post[data-work="${wid}"] .post-comments').textContent`)).includes('スタンプは消されました'));

  /* 変なデータのスタンプは表示しない */
  await ev(`(() => { stampCache.set('evil', 'javascript:alert(1)'); return 1; })()`);
  const evilHtml = await ev(`commentBodyHTML({ stampId: 'evil', text: '' })`);
  check('画像でないスタンプのデータは表示しない', !evilHtml.includes('javascript:'), evilHtml);

  check('JavaScript のエラーが出ていない', errors.length === 0, errors.join(' / '));

  ws.close(); br.kill(); await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  for (const r of results) console.log((r.ok ? 'OK  ' : 'NG  ') + r.name + (!r.ok && r.detail ? '  … ' + r.detail : ''));
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} 通過`);
}
main().catch(e => { console.error(e); process.exit(1); });
