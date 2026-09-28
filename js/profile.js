/* ============================================================
   profile.js — 見に来た人のプロフィール（なまえ＋アイコン）
   ------------------------------------------------------------
   コメントするには、最低でも「なまえ」と「アイコン」が必要。
   アイコンは3通り作れる。
     ・えらぶ … 用意された絵柄から選ぶ
     ・描く   … その場で描く（image に画像として入る）
     ・写真   … 手持ちの写真を丸く切り抜く（同上）
   Googleと紐づけると、Googleの名前と写真をそのまま使える。
   保存先はこのブラウザ（localStorage）。
   ============================================================ */
'use strict';

window.Profile = (function () {

  const KEY = 'tsubaki.profile';

  /* ---------- 選べるアイコン ---------- */
  /* {{bg}} は背景色に置き換わります（切り抜きに使う） */
  const ICONS = {
    camellia: { label: '椿', svg:
      `<g transform="translate(12 12)">
         <ellipse rx="5" ry="6.4" cy="-3.4"/>
         <ellipse rx="5" ry="6.4" cy="-3.4" transform="rotate(72)"/>
         <ellipse rx="5" ry="6.4" cy="-3.4" transform="rotate(144)"/>
         <ellipse rx="5" ry="6.4" cy="-3.4" transform="rotate(216)"/>
         <ellipse rx="5" ry="6.4" cy="-3.4" transform="rotate(288)"/>
         <circle r="2.6" fill="{{bg}}"/>
       </g>` },

    star: { label: '星', svg:
      `<path d="M12 2.8l2.7 5.7 6.2.8-4.5 4.3 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3.1 9.3l6.2-.8z"/>` },

    moon: { label: '月', svg:
      `<path d="M15.6 2.6a9.4 9.4 0 1 0 5.8 8.7 7.3 7.3 0 0 1-5.8-8.7z"/>` },

    cat: { label: 'ねこ', svg:
      `<path d="M4.4 8.6 5.5 3.7l3.4 2.5a8.8 8.8 0 0 1 6.2 0l3.4-2.5 1.1 4.9a7.8 7.8 0 1 1-15.2 0z"/>
       <circle cx="9.2" cy="12.2" r="1.2" fill="{{bg}}"/>
       <circle cx="14.8" cy="12.2" r="1.2" fill="{{bg}}"/>
       <path d="M12 14.6a1.6 1 0 0 0 1.6 1 1.6 1 0 0 0-1.6-1 1.6 1 0 0 0-1.6 1 1.6 1 0 0 0 1.6-1z" fill="{{bg}}"/>` },

    leaf: { label: '葉', svg:
      `<path d="M20 3.4C10.4 3.4 5 7.8 5 14a6.4 6.4 0 0 0 1.1 3.6l-2.3 2.4 1.4 1.4 2.4-2.3A6.4 6.4 0 0 0 11 20.2c6.2 0 9-6.4 9-16.8z"/>
       <path d="M17 6.6 8.4 16.4" stroke="{{bg}}" stroke-width="1.3" fill="none"/>` },

    drop: { label: 'しずく', svg:
      `<path d="M12 2.6s6.4 7.3 6.4 11.1A6.4 6.4 0 0 1 5.6 13.7C5.6 9.9 12 2.6 12 2.6z"/>
       <circle cx="9.6" cy="14.6" r="1.5" fill="{{bg}}"/>` },

    note: { label: '音符', svg:
      `<path d="M9.4 17.9a2.7 2.7 0 1 1-1.8-2.5V4.3l10.6-2.1v10.5a2.7 2.7 0 1 1-1.8-2.5V6.1L9.4 7.8z"/>` },

    heart: { label: 'ハート', svg:
      `<path d="M12 20.8 4 13a4.9 4.9 0 0 1 7-6.9l1 1 1-1a4.9 4.9 0 0 1 7 6.9z"/>` },
  };

  const COLORS = [
    '#c62b3d', '#e0783c', '#e8b84b', '#3f6b46',
    '#3d7ea6', '#7a5ba8', '#d9639a', '#4a4038',
  ];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* ---------- 保存 ---------- */
  function get() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY));
      if (p && p.name && (p.image || p.icon || p.url)) return p;
    } catch {}
    return null;
  }

  function save(p) {
    const clean = {
      name:  String(p.name || '').trim().slice(0, 20),
      icon:  ICONS[p.icon] ? p.icon : 'camellia',
      color: COLORS.includes(p.color) ? p.color : COLORS[0],
      image: isDataImage(p.image) ? p.image : null,   /* 描いた絵・切り抜いた写真 */
      url:   p.url || null,                           /* Google の写真 */
      linked: !!p.linked,
    };
    if (!clean.name) throw new Error('なまえを入れて');
    try {
      localStorage.setItem(KEY, JSON.stringify(clean));
    } catch (e) {
      /* 画像が大きすぎて入らないことがある。そのときは画像だけ捨てる */
      if (clean.image) {
        clean.image = null;
        try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch {}
        throw new Error('画像が大きすぎて保存できなかった。描き直すか、別の写真で試して');
      }
      throw e;
    }
    return clean;
  }

  function clear() { try { localStorage.removeItem(KEY); } catch {} }

  /* ---------- 表示 ---------- */
  /** data URL の画像かどうか（変なものを入れられないように） */
  function isDataImage(v) {
    return typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v) && v.length < 900000;
  }

  function avatarHTML(av, size = 34) {
    const px = `width:${size}px;height:${size}px`;
    if (av?.image) {
      return `<span class="ava" style="${px}"><img src="${esc(av.image)}" alt=""></span>`;
    }
    if (av?.url) {
      return `<span class="ava" style="${px}"><img src="${esc(av.url)}" alt="" referrerpolicy="no-referrer"></span>`;
    }
    const key   = ICONS[av?.icon] ? av.icon : 'camellia';
    const color = av?.color || COLORS[0];
    const inner = ICONS[key].svg.split('{{bg}}').join(color);
    return `<span class="ava" style="${px};background:${esc(color)}">
              <svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">${inner}</svg>
            </span>`;
  }

  return { ICONS, COLORS, get, save, clear, avatarHTML, esc, isDataImage };
})();
