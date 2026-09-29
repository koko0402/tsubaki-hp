/* 椿HP を見本モードで開いて、ログイン〜いいね〜コメント〜ログアウトを実際に操作して確かめる。
   使い方: node ui_test.js <椿HPのフォルダ> <スクショの出力先フォルダ> */
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
  const port = 9341;
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

  const url = 'file:///' + path.resolve(site, 'index.html').replace(/\\/g, '/');
  await s.send('Page.navigate', { url });
  await sleep(2500);
  await ev('window.confirm = () => true; 1');

  check('開いたとき、上のバーは「ログイン」', (await ev(`document.querySelector('#profileChip').textContent.trim()`)) === 'ログイン');
  check('投稿が並んでいる', (await ev(`document.querySelectorAll('.post').length`)) > 0);
  check('ログイン前の書き込み欄は「ログインするとコメントできます」',
    (await ev(`document.querySelector('.post-write').textContent.trim()`)).includes('ログインするとコメントできます'));
  await shot('01-未ログイン');

  /* いいねを押すとログイン画面が出る */
  const wid = await ev(`document.querySelector('.post').dataset.work`);
  await ev(`document.querySelector('[data-heart]').click(); 1`);
  await sleep(400);
  check('未ログインでいいね → ログイン画面が出る', (await ev(`!document.querySelector('#loginModal').hidden`)) === true);
  check('ログイン画面に「いいねするには」と出る',
    (await ev(`document.querySelector('#loginLead').textContent`)).includes('いいねするには'));
  check('見本モードでは「見本ユーザーでログイン」ボタンが出る', (await ev(`!document.querySelector('#loginDemo').hidden`)) === true);
  check('見本モードでは Google ボタンは出ない', (await ev(`document.querySelector('#loginGoogle').hidden`)) === true);
  check('いいねは付いていない', (await ev(`document.querySelector('[data-heart]').classList.contains('is-on')`)) === false);
  await shot('02-ログイン画面');

  /* ログインする */
  await ev(`document.querySelector('#loginDemo').click(); 1`);
  await sleep(1200);
  check('ログインしたら画面が閉じる', (await ev(`document.querySelector('#loginModal').hidden`)) === true);
  check('上のバーが自分の名前になる', (await ev(`document.querySelector('#profileChip').textContent.trim()`)) === '見本ユーザー');
  check('書き込み欄が入力できる形になる', (await ev(`!!document.querySelector('.post-write input')`)) === true);

  /* いいね */
  const before = await ev(`statOf(${JSON.stringify(wid)}).hearts`);
  await ev(`document.querySelector('[data-heart]').click(); 1`);
  await sleep(800);
  check('ログイン後はいいねできる', (await ev(`document.querySelector('[data-heart]').classList.contains('is-on')`)) === true);
  check('いいね数が1増える', (await ev(`statOf(${JSON.stringify(wid)}).hearts`)) === before + 1);

  /* コメント */
  await ev(`(() => { const f = document.querySelector('.post-write'); f.querySelector('input').value = 'テストのコメント'; f.requestSubmit(); return 1; })()`);
  await sleep(1500);
  check('フィードからコメントできる',
    (await ev(`[...document.querySelectorAll('.post')[0].querySelectorAll('.c-text')].some(p => p.textContent === 'テストのコメント')`)) === true);
  await shot('03-ログイン後');

  /* 変な色を仕込んだコメントが来ても、プログラムは動かない */
  await ev(`Demo.api.addComment(${JSON.stringify(wid)}, { name: 'わるもの', icon: 'star',
            color: '"/><img src=x onerror="window.__pwned=1">' }, '色に細工') .then(() => fillPostComments([${JSON.stringify(wid)}]))`);
  await sleep(1500);
  check('色に仕込まれたプログラムは動かない', (await ev(`window.__pwned === undefined`)) === true);
  check('細工したコメント自体は表示される(色は既定に戻る)',
    (await ev(`[...document.querySelectorAll('.c-text')].some(p => p.textContent === '色に細工')`)) === true);
  check('ページに onerror 付きの img が入っていない', (await ev(`document.querySelectorAll('img[onerror]').length`)) === 0);

  /* 拡大表示の中のコメント欄 */
  await ev(`openLightbox(${JSON.stringify(wid)}); 1`);
  await sleep(1200);
  check('拡大表示でコメントを書ける状態', (await ev(`!document.querySelector('#lbCommentForm').hidden`)) === true);
  await shot('04-拡大表示');
  await ev(`closeLightbox(); 1`);

  /* 「わたし」ページ */
  await ev(`showPage('me'); 1`);
  await sleep(500);
  check('わたしページに「見本ユーザーでログイン中」', (await ev(`document.querySelector('#meCard').textContent`)).includes('見本ユーザーでログイン中'));

  /* ログアウト */
  await ev(`showPage('home'); 1`);
  await sleep(500);
  await ev(`document.querySelector('#profileChip').click(); 1`);
  await sleep(400);
  check('プロフィール画面にログアウトボタンが出る', (await ev(`!document.querySelector('#pfAccount').hidden`)) === true);
  await shot('05-プロフィール');
  await ev(`document.querySelector('[data-logout]').click(); 1`);
  await sleep(1500);
  check('ログアウトしたら上のバーが「ログイン」に戻る', (await ev(`document.querySelector('#profileChip').textContent.trim()`)) === 'ログイン');
  check('ログアウトしたら、いいね済みの表示が消える', (await ev(`document.querySelector('[data-heart]').classList.contains('is-on')`)) === false);
  check('ログアウト後の書き込み欄は「ログインするとコメントできます」',
    (await ev(`document.querySelector('.post-write').textContent.trim()`)).includes('ログインするとコメントできます'));

  /* 再読み込みしてもログイン状態が戻る／戻らない */
  await ev(`Demo.auth.signIn().then(() => 1)`);
  await s.send('Page.reload');
  await sleep(2500);
  check('ログインしたまま再読み込み → ログインが続いている', (await ev(`document.querySelector('#profileChip').textContent.trim()`)) === '見本ユーザー');
  check('再読み込み後も自分のいいねが残っている', (await ev(`state.myHearts.has(${JSON.stringify(wid)})`)) === true);

  check('JavaScript のエラーが出ていない', errors.length === 0, errors.join(' / '));

  ws.close(); br.kill(); await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}

  for (const r of results) console.log((r.ok ? 'OK  ' : 'NG  ') + r.name + (!r.ok && r.detail ? '  … ' + r.detail : ''));
  const ng = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} 通過`);
}
main().catch(e => { console.error(e); process.exit(1); });
