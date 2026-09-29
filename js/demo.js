/* ============================================================
   demo.js — サーバー(Supabase)を使わないときの保存先
   ------------------------------------------------------------
   この端末のブラウザの中（IndexedDB）に全部しまいます。
   ・絵の画像そのものも保存できるので、投稿の練習ができます
   ・でも「この端末の中だけ」です。他の人には何も見えません
   ・中身は js/data.js を最初に一度だけ写して作られます

   config.js を設定すると、こちらは使われなくなり Supabase に切り替わります。
   関数の形は js/db.js とそろえてあるので、画面側のコードは共通です。
   ============================================================ */
'use strict';

window.Demo = (function () {

  const DB_NAME = 'tsubaki-demo';
  const VERSION = 2;   /* 2: スタンプの置き場を足した */
  const STORES  = ['meta', 'works', 'posts', 'comments', 'images', 'stamps'];

  let dbp = null;
  const urlCache = new Map();   // idb:xxx → blob URL

  /* ---------- IndexedDB のごく薄いラッパ ---------- */
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('meta'))     db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('works'))    db.createObjectStore('works',    { keyPath: 'id' });
        if (!db.objectStoreNames.contains('posts'))    db.createObjectStore('posts',    { keyPath: 'id' });
        if (!db.objectStoreNames.contains('comments')) db.createObjectStore('comments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images'))   db.createObjectStore('images');
        if (!db.objectStoreNames.contains('stamps'))   db.createObjectStore('stamps',   { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror   = () => reject(r.error);
    });
    return dbp;
  }

  const wrap = r => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });

  async function store(name, mode = 'readonly') {
    const db = await openDB();
    return db.transaction(name, mode).objectStore(name);
  }

  const getAll = async name => (await wrap((await store(name)).getAll())) || [];
  const getKey = async (name, key) => wrap((await store(name)).get(key));
  const put    = async (name, value, key) =>
    wrap((await store(name, 'readwrite')).put(value, key));
  const del    = async (name, key) => wrap((await store(name, 'readwrite')).delete(key));

  const uid = () =>
    (crypto.randomUUID?.() || 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));

  const todayStr = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* ---------- 最初の1回だけ、data.js の中身を写す ---------- */
  async function seedIfNeeded() {
    if (await getKey('meta', 'seeded')) return;

    for (let i = 0; i < GALLERY.length; i++) {
      const w = GALLERY[i];
      await put('works', {
        id: w.id,
        title: w.title,
        imagePath: w.file || (w.files && w.files[0]) || '',
        imagePaths: Array.isArray(w.files) ? w.files : (w.file ? [w.file] : []),
        artist: w.artist,
        date: w.date,
        desc: w.desc || '',
        tags: w.tags || [],
        baseViews: w.baseViews || 0,
        baseHearts: w.baseHearts || 0,
        isPickup: (PICKUP.workIds || []).includes(w.id),
        pickupOrder: (PICKUP.workIds || []).indexOf(w.id),
        order: i,
      });

      /* コメントと、そこにぶら下がる返信 */
      const seedComment = async (c, workId, parentId) => {
        const id = uid();
        await put('comments', {
          id, workId, parentId: parentId || null,
          name: c.name, body: c.text, date: c.date || todayStr(),
          avatarIcon: c.avatar?.icon || null,
          avatarColor: c.avatar?.color || null,
          avatarUrl: c.avatar?.url || null,
          createdAt: (c.date || todayStr()) + 'T00:00:00',
        });
        for (const r of (c.replies || [])) await seedComment(r, workId, id);
      };
      for (const c of (w.comments || [])) await seedComment(c, w.id, null);
    }

    for (const p of BLOG) {
      await put('posts', { id: p.id || uid(), date: p.date, title: p.title, body: p.body, pinned: !!p.pinned });
    }

    await put('meta', {
      title: SITE.title,
      tagline: SITE.tagline,
      links: SITE.links || [],
      artists: SITE.artists || {},
      theme:      SITE.theme || {},
      sections:   SITE.sections || {},
      custom_css: SITE.customCss || '',
      bg_image: SITE.bgImage || '',
      bg_mode:  SITE.bgMode  || 'cover',
      bg_dim:   SITE.bgDim ?? 0.25,
      pickup_message: PICKUP.message || '',
      youtube_id: PICKUP.youtubeId || '',
      youtube_title: PICKUP.youtubeTitle || '',
      require_login_to_comment: false,
    }, 'settings');

    await put('meta', [], 'hearts');
    await put('meta', {}, 'views');
    await put('meta', true, 'seeded');
  }

  let readyP = null;
  function init() {
    if (!readyP) readyP = seedIfNeeded();
    return readyP;
  }

  /* ---------- 画像 ---------- */
  async function imageUrl(path) {
    if (!path) return '';
    if (!path.startsWith('idb:')) return path;
    if (urlCache.has(path)) return urlCache.get(path);
    const blob = await getKey('images', path);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urlCache.set(path, url);
    return url;
  }

  /* ---------- 形をそろえる ---------- */
  async function toWork(row) {
    return {
      id: row.id,
      title: row.title,
      file: row.imagePath ? await imageUrl(row.imagePath) : '',
      files: await Promise.all((row.imagePaths || (row.imagePath ? [row.imagePath] : []))
               .map(p => imageUrl(p))),
      imagePath: row.imagePath,
      imagePaths: row.imagePaths || [],
      artist: row.artist,
      date: row.date,
      desc: row.desc || '',
      tags: row.tags || [],
      isPickup: !!row.isPickup,
      pickupOrder: row.pickupOrder,
    };
  }

  const toComment = row => ({
    id: row.id,
    workId: row.workId,
    parentId: row.parentId || null,
    name: row.name,
    text: row.body,
    date: row.date,
    avatar: { icon: row.avatarIcon, color: row.avatarColor, url: row.avatarUrl },
    stampId: row.stampId || null,
  });

  const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  /* ============================================================
     ログイン（見本）
     ------------------------------------------------------------
     本番は Google でログインするけれど、見本モードにはサーバーが無い。
     なので「見本ユーザー」でログインしたことにして、ボタン1つで試せるようにする。
     ログインしないといいね・コメントできないのは本番と同じ。
     ============================================================ */
  const AKEY = 'tsubaki.demo.account';

  const auth = {
    async account() {
      try { return JSON.parse(localStorage.getItem(AKEY)) || null; } catch { return null; }
    },
    async signIn() {
      const a = { id: 'demo-user', email: '', name: '見本ユーザー', picture: null };
      try { localStorage.setItem(AKEY, JSON.stringify(a)); } catch {}
      return a;
    },
    async signOut() { try { localStorage.removeItem(AKEY); } catch {} },
  };

  async function needLogin() {
    if (!(await auth.account())) throw new Error('ログインが必要です');
  }

  /* ============================================================
     見る側
     ============================================================ */
  const api = {
    online: false,

    async loadAll() {
      await init();
      const [rows, posts, comments, s, hearts, views] = await Promise.all([
        getAll('works'), getAll('posts'), getAll('comments'),
        getKey('meta', 'settings'), getKey('meta', 'hearts'), getKey('meta', 'views'),
      ]);

      const heartList = hearts || [];
      const viewMap   = views || {};

      const gallery = [];
      for (const r of rows.sort(byDateDesc)) gallery.push(await toWork(r));

      const stats = {};
      for (const r of rows) {
        stats[r.id] = {
          views:    (r.baseViews  || 0) + (viewMap[r.id] || 0),
          hearts:   (r.baseHearts || 0) + (heartList.includes(r.id) ? 1 : 0),
          comments: comments.filter(c => c.workId === r.id).length,
        };
      }

      const picks = rows.filter(r => r.isPickup)
        .sort((a, b) => (a.pickupOrder ?? 999) - (b.pickupOrder ?? 999));

      return {
        site: {
          title:   s?.title   || '椿@お絵描き局',
          tagline: s?.tagline || '',
          links:   s?.links   || [],
          artists: s?.artists || {},
          theme:     s?.theme || {},
          sections:  s?.sections || {},
          customCss: s?.custom_css || '',
          bgImage: s?.bg_image || '',
          bgMode:  s?.bg_mode  || 'cover',
          bgDim:   s?.bg_dim ?? 0.25,
        },
        pickup: {
          message:      s?.pickup_message || '',
          workIds:      picks.map(r => r.id),
          youtubeId:    s?.youtube_id || '',
          youtubeTitle: s?.youtube_title || '',
        },
        gallery,
        blog: posts.sort(byDateDesc),
        stats,
        /* ログアウト中は「自分が押したハート」は無いものとして見せる（本番と同じ） */
        myHearts: new Set((await auth.account()) ? heartList : []),
      };
    },

    async comments(workId) {
      const rows = await getAll('comments');
      return rows.filter(c => c.workId === workId)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .map(toComment);
    },

    async recentComments(ids, perWork = 2) {
      const rows = await getAll('comments');
      const out = {};
      for (const id of ids) {
        /* フィードに出すのは、いちばん上のコメントだけ（返信は開いてから見る） */
        const list = rows.filter(c => c.workId === id && !c.parentId)
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
          .slice(-perWork).map(toComment);
        if (list.length) out[id] = list;
      }
      return out;
    },

    async addComment(workId, profile, text, parentId = null, stampId = null) {
      await needLogin();
      if (!String(text || '').trim() && !stampId) throw new Error('コメントを書くか、スタンプを選んでください');
      const now = new Date().toISOString();
      await put('comments', {
        id: uid(), workId, parentId: parentId || null,
        name: profile.name, body: text, date: todayStr(),
        avatarIcon: profile.url ? null : profile.icon,
        avatarColor: profile.url ? null : profile.color,
        avatarUrl: profile.url || null,
        stampId: stampId || null,
        createdAt: now,
      });
    },

    /* ---------- スタンプ（本番と同じ関数名。数の上限だけ簡単に真似する） ---------- */
    async stamps(ids) {
      const out = {};
      for (const id of new Set(ids)) {
        if (!id) continue;
        const row = await getKey('stamps', id);
        if (row) out[id] = row.data;
      }
      return out;
    },

    async myStamps() {
      const me = await auth.account();
      if (!me) return [];
      return (await getAll('stamps'))
        .filter(r => r.userId === me.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map(r => ({ id: r.id, data: r.data }));
    },

    async createStamp(data) {
      const me = await auth.account();
      if (!me) throw new Error('ログインが必要です');
      if (!/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 60000) {
        throw new Error('スタンプの形式がちがいます');
      }
      const mine = (await getAll('stamps')).filter(r => r.userId === me.id);
      if (mine.length >= 30) throw new Error('スタンプは30個までです。いらないものを消してから作ってください');
      const id = uid();
      await put('stamps', { id, userId: me.id, data, createdAt: new Date().toISOString() });
      return id;
    },

    async deleteStamp(id) {
      await del('stamps', id);
      /* 本番と同じく、使っていたコメントからは外す（コメントは残す） */
      for (const c of await getAll('comments')) {
        if (c.stampId === id) await put('comments', { ...c, stampId: null });
      }
    },

    async toggleHeart(workId) {
      await needLogin();
      const list = (await getKey('meta', 'hearts')) || [];
      const on = !list.includes(workId);
      await put('meta', on ? list.concat(workId) : list.filter(x => x !== workId), 'hearts');
      return on;
    },

    async registerView(workId) {
      let seen = [];
      try { seen = JSON.parse(sessionStorage.getItem('tsubaki.demo.seen')) || []; } catch {}
      if (seen.includes(workId)) return;
      seen.push(workId);
      try { sessionStorage.setItem('tsubaki.demo.seen', JSON.stringify(seen)); } catch {}

      const views = (await getKey('meta', 'views')) || {};
      views[workId] = (views[workId] || 0) + 1;
      await put('meta', views, 'views');
    },
  };

  /* ============================================================
     投稿する側
     ============================================================ */
  const admin = {
    async listWorks() {
      await init();
      const rows = (await getAll('works')).sort(byDateDesc);
      const out = [];
      for (const r of rows) out.push(await toWork(r));
      return out;
    },

    async listPosts() {
      await init();
      return (await getAll('posts')).sort(byDateDesc);
    },

    async settings() {
      await init();
      return (await getKey('meta', 'settings')) || {};
    },

    async saveSettings(patch) {
      const cur = (await getKey('meta', 'settings')) || {};
      await put('meta', { ...cur, ...patch }, 'settings');
    },

    /** File をそのまましまって、参照用のキーを返す */
    async uploadImage(file) {
      const ext  = (file.name.split('.').pop() || 'png').toLowerCase();
      const key  = `idb:${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await put('images', file, key);
      return key;
    },

    /** いらなくなった絵を置き場から消す（編集で外したときに使う） */
    async removeImages(paths) {
      for (const p of (paths || [])) {
        if (!String(p).startsWith('idb:')) continue;
        await del('images', p);
        const url = urlCache.get(p);
        if (url) { URL.revokeObjectURL(url); urlCache.delete(p); }
      }
    },

    async saveWork(work) {
      const old = (await getKey('works', work.id)) || {};
      /* 絵は何枚でも持てる。imagePath は「1枚目」で、古い作りとの互換用 */
      const paths = Array.isArray(work.imagePaths)
        ? work.imagePaths.filter(Boolean)
        : (work.imagePath ? [work.imagePath] : []);
      await put('works', {
        ...old,
        id: work.id,
        title: work.title,
        imagePath: paths[0] || '',
        imagePaths: paths,
        artist: work.artist,
        date: work.date,
        desc: work.desc || '',
        tags: work.tags || [],
        baseViews:  old.baseViews  || 0,
        baseHearts: old.baseHearts || 0,
        isPickup: !!work.isPickup,
        pickupOrder: work.isPickup ? (work.pickupOrder ?? 1) : null,
      });
    },

    async setPickup(id, on, order) {
      const row = await getKey('works', id);
      if (!row) return;
      row.isPickup = on;
      row.pickupOrder = on ? (order ?? 1) : null;
      await put('works', row);
    },

    async deleteWork(id, imagePath) {
      await del('works', id);
      const rows = await getAll('comments');
      for (const c of rows) if (c.workId === id) await del('comments', c.id);

      /* 1枚でも複数枚でも受け取れるようにしておく */
      const paths = (Array.isArray(imagePath) ? imagePath : [imagePath]).filter(Boolean);
      for (const p of paths) {
        if (!String(p).startsWith('idb:')) continue;
        await del('images', p);
        const url = urlCache.get(p);
        if (url) { URL.revokeObjectURL(url); urlCache.delete(p); }
      }
    },

    async savePost(post) {
      await put('posts', {
        id: post.id || uid(),
        date: post.date, title: post.title, body: post.body, pinned: !!post.pinned,
      });
    },

    async deletePost(id) { await del('posts', id); },

    async listComments() {
      await init();
      return (await getAll('comments'))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 100)
        .map(c => ({ id: c.id, work_id: c.workId, parent_id: c.parentId || null,
                     name: c.name, body: c.body, created_at: c.createdAt }));
    },

    async listStamps() {
      await init();
      return (await getAll('stamps'))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 200)
        .map(r => ({ id: r.id, user_id: r.userId, data: r.data, created_at: r.createdAt }));
    },

    async deleteStamp(id) { await api.deleteStamp(id); },

    /* 親を消したら、そこにぶら下がっていた返信もいっしょに消す */
    async deleteComment(id) {
      const rows = await getAll('comments');
      for (const c of rows) if (c.parentId === id) await del('comments', c.id);
      await del('comments', id);
    },

    /** 全部消して、js/data.js の中身に戻す */
    async reset() {
      const db = await openDB();
      await new Promise((res, rej) => {
        const t = db.transaction(STORES, 'readwrite');
        STORES.forEach(n => t.objectStore(n).clear());
        t.oncomplete = res; t.onerror = () => rej(t.error);
      });
      for (const url of urlCache.values()) URL.revokeObjectURL(url);
      urlCache.clear();
      readyP = null;
      await init();
    },
  };

  return { init, api, admin, auth, imageUrl };
})();
