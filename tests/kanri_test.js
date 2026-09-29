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
  s.on('Page.javascriptDialogOpening', () => s.send('Page.handleJavaScriptDialog', { accept: true }));
  const url = 'file:///' + path.resolve(site, 'kanri-7f3a2c/index.html').split(path.sep).join('/');
  await s.send('Page.navigate', { url });
  await sleep(2500);
  check('管理ページが開く(設定の入力欄がある)', (await ev(`!!document.querySelector('#sTitle')`)) === true);
  check('コメント必須の切り替えが無くなっている', (await ev(`!document.querySelector('#sRequireLogin')`)) === true);
  await ev(`document.querySelector('#sTitle').value = '椿@テスト'; 1`);
  const btn = await ev(`(() => { const f = document.querySelector('#sTitle').closest('form') || document.querySelector('#sTitle').closest('section'); const b = f && [...f.querySelectorAll('button')].find(x => /保存/.test(x.textContent)); if (b) { b.click(); return b.textContent.trim(); } return null; })()`);
  await sleep(1500);
  check('サイト設定の保存ボタンを押せた', !!btn, String(btn));
  check('保存しました と出る', (await ev(`document.querySelector('#sMsg')?.textContent || ''`)).includes('保存しました'));
  const saved = await ev(`Demo.admin.settings().then(x => x.title)`);
  check('設定が本当に保存されている', saved === '椿@テスト', saved);
  await ev(`Demo.admin.saveSettings({ title: '椿@お絵描き局' }).then(() => 1)`);
  check('JavaScript のエラーが出ていない', errors.length === 0, errors.join(' / '));
  ws.close(); br.kill(); await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  for (const r of results) console.log((r.ok ? 'OK  ' : 'NG  ') + r.name + (!r.ok && r.detail ? '  … ' + r.detail : ''));
  const ng = results.filter(r => !r.ok).length;
  console.log(`
${results.length - ng}/${results.length} 通過`);
}
main().catch(e => { console.error(e); process.exit(1); });
