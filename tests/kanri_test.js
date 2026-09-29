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
  /* 上げる前に縮める処理 */
  const shrink = await ev(`(async () => {
    /* 模様を細かくして、わざと重い絵を作る */
    const make = (w, h, type, transparent) => new Promise(res => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d');
      if (!transparent) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = 'hsl(' + (i * 37 % 360) + ',70%,50%)';
        g.fillRect((i * 131) % w, (i * 197) % h, 30 + i % 40, 30 + i % 50);
      }
      if (transparent) g.clearRect(0, 0, 200, 200);   /* 左上は透明のまま */
      c.toBlob(b => res(new File([b], 'test.' + (type === 'image/png' ? 'png' : 'jpg'), { type })), type, .95);
    });
    const size = async f => { const b = await createImageBitmap(f); const r = [b.width, b.height]; b.close(); return r; };
    const alphaAt = async (f, x, y) => { const b = await createImageBitmap(f); const c = document.createElement('canvas');
      c.width = b.width; c.height = b.height; const g = c.getContext('2d'); g.drawImage(b, 0, 0); return g.getImageData(x, y, 1, 1).data[3]; };

    const big = await make(4000, 3000, 'image/jpeg', false);
    const bigOut = await shrinkImage(big);
    const small = await make(800, 600, 'image/jpeg', false);
    const smallOut = await shrinkImage(small);
    const clear = await make(3000, 3000, 'image/png', true);
    const clearOut = await shrinkImage(clear);
    const gif = new File([new Uint8Array([71,73,70,56,57,97])], 'a.gif', { type: 'image/gif' });
    return {
      bigIn: big.size, bigOut: bigOut.size, bigDim: await size(bigOut), bigType: bigOut.type,
      smallSame: smallOut === small,
      clearDim: await size(clearOut), clearAlpha: await alphaAt(clearOut, 10, 10), clearType: clearOut.type,
      clearIn: clear.size, clearOutSize: clearOut.size,
      gifSame: (await shrinkImage(gif)) === gif,
    };
  })()`);
  check('大きい絵(4000x3000)は長い辺2400pxに縮む', shrink.bigDim[0] === 2400 && shrink.bigDim[1] === 1800, JSON.stringify(shrink.bigDim));
  check('縮めると軽くなる', shrink.bigOut < shrink.bigIn, `${shrink.bigIn} → ${shrink.bigOut}`);
  check('小さい絵はそのまま上げる', shrink.smallSame === true);
  check('透明のある絵は、透明が残る', shrink.clearAlpha === 0, JSON.stringify({ a: shrink.clearAlpha, t: shrink.clearType }));
  check('透明のある絵も、元より重くならない', shrink.clearOutSize <= shrink.clearIn, `${shrink.clearIn} → ${shrink.clearOutSize}`);
  check('GIF は触らない', shrink.gifSame === true);

  /* 見た目タブ（前は押しても中身が出なかった） */
  await ev(`document.querySelector('.tab[data-tab="look"]').click(); 1`);
  await sleep(300);
  check('「見た目」タブを押すと中身が出る', (await ev(`!document.querySelector('#tab-look').classList.contains('hidden')`)) === true);

  /* スタンプタブ：見本モードにスタンプを1つ作ってから開く */
  await ev(`Demo.auth.signIn().then(() => Demo.api.createStamp('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).then(() => 1)`);
  await ev(`document.querySelector('.tab[data-tab="stamps"]').click(); 1`);
  await sleep(800);
  check('「スタンプ」タブで一覧が出る', (await ev(`document.querySelectorAll('#stampList .stamp-item').length`)) === 1);
  await shot('k-スタンプ管理');
  await ev(`document.querySelector('#stampList [data-sdel]').click(); 1`);
  await sleep(800);
  check('管理ページからスタンプを消せる', (await ev(`document.querySelectorAll('#stampList .stamp-item').length`)) === 0);

  check('JavaScript のエラーが出ていない', errors.length === 0, errors.join(' / '));
  ws.close(); br.kill(); await sleep(400);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  for (const r of results) console.log((r.ok ? 'OK  ' : 'NG  ') + r.name + (!r.ok && r.detail ? '  … ' + r.detail : ''));
  const ng = results.filter(r => !r.ok).length;
  console.log(`
${results.length - ng}/${results.length} 通過`);
}
main().catch(e => { console.error(e); process.exit(1); });
