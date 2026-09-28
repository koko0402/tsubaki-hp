/* ============================================================
   db.js — Supabase とのやりとり
   ------------------------------------------------------------
   ・見る側が使うもの        → DB.api
   ・投稿する側が使うもの    → DB.auth / DB.admin （管理ページ専用）
   config.js が空なら DB.configured が false になり、
   app.js は js/data.js の見本データで表示します。
   ============================================================ */
'use strict';

window.DB = (function () {

  const cfg = window.TSUBAKI_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const BUCKET = cfg.storageBucket || 'art';

  let sb = null;

  function init() {
    if (sb) return sb;
    if (!configured) throw new Error('config.js が未設定です');
    if (!window.supabase?.createClient) throw new Error('supabase-js が読み込めていません');
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return sb;
  }

  /* ---------- 見に来た人のランダムID（誰かは分からない） ---------- */
  const VKEY = 'tsubaki.visitor';
  function visitorId() {
    let v = null;
    try { v = localStorage.getItem(VKEY); } catch {}
    if (!v) {
      v = (crypto.randomUUID?.() ) || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      try { localStorage.setItem(VKEY, v); } catch {}
    }
    return v;
  }

  /* ---------- 画像パス → 表示できるURL ---------- */
  function imageUrl(path) {
    if (!path) return '';
    if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const ok = (res, what) => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  };

  /* 画面側で使う形にそろえる（js/data.js と同じ項目名） */
  function toWork(row) {
    return {
      id: row.id,
      title: row.title,
      file: row.image_path ? imageUrl(row.image_path) : '',
      files: (row.image_paths && row.image_paths.length ? row.image_paths
              : (row.image_path ? [row.image_path] : [])).map(imageUrl),
      imagePath: row.image_path,
      imagePaths: row.image_paths || [],
      artist: row.artist,
      date: row.posted_on,
      desc: row.description || '',
      tags: row.tags || [],
      isPickup: row.is_pickup,
      pickupOrder: row.pickup_order,
    };
  }

  const toPost = row => ({
    id: row.id, date: row.posted_on, title: row.title,
    body: row.body, pinned: row.pinned,
  });

  const toComment = row => ({
    id: row.id,
    workId: row.work_id,
    parentId: row.parent_id || null,
    name: row.name,
    text: row.body,
    date: String(row.created_at).slice(0, 10),
    avatar: { icon: row.avatar_icon, color: row.avatar_color, url: row.avatar_url },
    verified: !!row.user_id,
  });

  /* ============================================================
     見る側
     ============================================================ */
  const api = {
    online: true,

    async loadAll() {
      const me = visitorId();
      const [settings, works, posts, stats, mine] = await Promise.all([
        sb.from('site_settings').select('*').eq('id', 1).maybeSingle(),
        sb.from('works').select('*').order('posted_on', { ascending: false }).order('created_at', { ascending: false }),
        sb.from('blog_posts').select('*').order('posted_on', { ascending: false }),
        sb.from('work_stats').select('*'),
        sb.from('hearts').select('work_id').eq('visitor_id', me),
      ]);

      const s = ok(settings, 'サイト設定の読み込み') || {};
      const workRows = ok(works, '作品の読み込み') || [];
      const gallery  = workRows.map(toWork);

      const statMap = {};
      for (const r of ok(stats, '集計の読み込み') || []) {
        statMap[r.work_id] = { views: r.views, hearts: r.hearts, comments: r.comments };
      }
      for (const w of gallery) statMap[w.id] ||= { views: 0, hearts: 0, comments: 0 };

      const pickups = workRows
        .filter(r => r.is_pickup)
        .sort((a, b) => (a.pickup_order ?? 999) - (b.pickup_order ?? 999));

      return {
        site: {
          title:   s.title   || '椿@お絵描き局',
          tagline: s.tagline || '絵を展示する場所',
          links:   Array.isArray(s.links) ? s.links : [],
          artists: s.artists || {},
          theme:     s.theme || {},
          sections:  s.sections || {},
          customCss: s.custom_css || '',
          bgImage: s.bg_image || '',
          bgMode:  s.bg_mode  || 'cover',
          bgDim:   s.bg_dim ?? 0.25,
          requireLogin: !!s.require_login_to_comment,
        },
        pickup: {
          message:      s.pickup_message || '',
          workIds:      pickups.map(r => r.id),
          youtubeId:    s.youtube_id || '',
          youtubeTitle: s.youtube_title || '',
        },
        gallery,
        blog: (ok(posts, 'ブログの読み込み') || []).map(toPost),
        stats: statMap,
        myHearts: new Set((ok(mine, 'ハートの読み込み') || []).map(r => r.work_id)),
      };
    },

    async comments(workId) {
      const rows = ok(await sb.from('comments')
        .select('*')
        .eq('work_id', workId)
        .order('created_at', { ascending: true }), 'コメントの読み込み');
      return (rows || []).map(toComment);
    },

    /** フィード用：複数の作品の新しいコメントをまとめて取る → { workId: [...] } */
    async recentComments(ids, perWork = 2) {
      if (!ids.length) return {};
      /* フィードに出すのは、いちばん上のコメントだけ（返信は開いてから見る） */
      const rows = ok(await sb.from('comments')
        .select('*')
        .in('work_id', ids)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .limit(300), 'コメントの読み込み') || [];

      const out = {};
      for (const r of rows) {
        (out[r.work_id] ||= []).push(toComment(r));
      }
      for (const k of Object.keys(out)) out[k] = out[k].slice(0, perWork).reverse();
      return out;
    },

    async addComment(workId, profile, text, parentId = null) {
      const user = (await sb.auth.getUser()).data.user;
      ok(await sb.from('comments').insert({
        work_id:      workId,
        parent_id:    parentId || null,
        name:         profile.name,
        body:         text,
        avatar_icon:  profile.url ? null : profile.icon,
        avatar_color: profile.url ? null : profile.color,
        avatar_url:   profile.url || null,
        visitor_id:   visitorId(),
        user_id:      user?.id || null,
      }), 'コメントの送信');
    },

    /** 押した後の状態(true/false)を返す */
    async toggleHeart(workId) {
      const res = await sb.rpc('toggle_heart', { p_work_id: workId, p_visitor: visitorId() });
      if (res.error) throw new Error('ハートの更新: ' + res.error.message);
      return res.data === true;
    },

    async registerView(workId) {
      await sb.rpc('register_view', { p_work_id: workId, p_visitor: visitorId() });
    },
  };

  /* ============================================================
     ログイン（管理ページ専用）
     ============================================================ */
  const auth = {
    async signIn(email, password) {
      const res = await sb.auth.signInWithPassword({ email, password });
      if (res.error) throw new Error('メールアドレスか合言葉がちがいます');
      return res.data.user;
    },
    async signOut() { await sb.auth.signOut(); },
    async user() { return (await sb.auth.getUser()).data.user || null; },

    /** 見に来た人が Google でログインする（プロフィールの紐付け用） */
    async signInWithGoogle() {
      const res = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.href.split('#')[0] },
      });
      if (res.error) throw new Error('Googleログイン: ' + res.error.message);
    },

    /** ログイン中のアカウントの表示情報（なければ null） */
    async account() {
      const u = await this.user();
      if (!u) return null;
      const m = u.user_metadata || {};
      return {
        id: u.id,
        email: u.email || '',
        name: m.full_name || m.name || (u.email || '').split('@')[0] || '',
        picture: m.avatar_url || m.picture || null,
      };
    },

    /** admins に載っているかを確認。載っていなければ null */
    async me() {
      const u = await this.user();
      if (!u) return null;
      const res = await sb.from('admins').select('*').eq('user_id', u.id).maybeSingle();
      if (res.error || !res.data) return null;
      return { ...res.data, email: u.email };
    },
  };

  /* ============================================================
     投稿・編集（管理ページ専用）
     ============================================================ */
  const admin = {
    async listWorks() {
      const rows = ok(await sb.from('works').select('*')
        .order('posted_on', { ascending: false }), '作品一覧');
      return (rows || []).map(toWork);
    },

    async listPosts() {
      const rows = ok(await sb.from('blog_posts').select('*')
        .order('posted_on', { ascending: false }), 'ブログ一覧');
      return (rows || []).map(toPost);
    },

    async settings() {
      return ok(await sb.from('site_settings').select('*').eq('id', 1).maybeSingle(), 'サイト設定');
    },

    async saveSettings(patch) {
      ok(await sb.from('site_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', 1), 'サイト設定の保存');
    },

    /** File を art バケットに上げて、保存されたパスを返す */
    async uploadImage(file) {
      const ext  = (file.name.split('.').pop() || 'png').toLowerCase();
      const rand = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 8);
      const d    = new Date();
      const path = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${Date.now()}-${rand}.${ext}`;
      const res  = await sb.storage.from(BUCKET).upload(path, file, {
        cacheControl: '31536000', upsert: false, contentType: file.type || undefined,
      });
      if (res.error) throw new Error('画像のアップロード: ' + res.error.message);
      return path;
    },

    /** いらなくなった絵を置き場から消す（編集で外したときに使う） */
    async removeImages(paths) {
      const list = (paths || []).filter(p => p && !/^https?:/.test(p));
      if (list.length) await sb.storage.from(BUCKET).remove(list);
    },

    async saveWork(work) {
      /* 絵は何枚でも持てる。image_path は「1枚目」で、古い作りとの互換用 */
      const paths = Array.isArray(work.imagePaths)
        ? work.imagePaths.filter(Boolean)
        : (work.imagePath ? [work.imagePath] : []);
      ok(await sb.from('works').upsert({
        id:           work.id,
        title:        work.title,
        image_path:   paths[0] || '',
        image_paths:  paths,
        artist:       work.artist,
        posted_on:    work.date,
        description:  work.desc || '',
        tags:         work.tags || [],
        is_pickup:    !!work.isPickup,
        pickup_order: work.pickupOrder ?? null,
      }), '作品の保存');
    },

    async setPickup(id, on, order) {
      ok(await sb.from('works').update({ is_pickup: on, pickup_order: on ? (order ?? 1) : null })
        .eq('id', id), 'おすすめの切り替え');
    },

    async deleteWork(id, imagePath) {
      ok(await sb.from('works').delete().eq('id', id), '作品の削除');

      /* 1枚でも複数枚でも受け取れるようにしておく */
      const paths = (Array.isArray(imagePath) ? imagePath : [imagePath])
        .filter(p => p && !/^https?:/.test(p));
      if (paths.length) {
        await sb.storage.from(BUCKET).remove(paths);   // 消せなくても致命的ではない
      }
    },

    async savePost(post) {
      const row = { posted_on: post.date, title: post.title, body: post.body, pinned: !!post.pinned };
      ok(post.id
        ? await sb.from('blog_posts').update(row).eq('id', post.id)
        : await sb.from('blog_posts').insert(row), 'ブログの保存');
    },

    async deletePost(id) {
      ok(await sb.from('blog_posts').delete().eq('id', id), 'ブログの削除');
    },

    async deleteComment(id) {
      ok(await sb.from('comments').delete().eq('id', id), 'コメントの削除');
    },

    async listComments() {
      const rows = ok(await sb.from('comments').select('*')
        .order('created_at', { ascending: false }).limit(100), 'コメント一覧');
      return rows || [];
    },
  };

  return { configured, init, visitorId, imageUrl, api, auth, admin, get client() { return sb; } };
})();
