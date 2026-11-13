/**
 * JOSH — shared client: API access, formatting helpers, UI primitives and the
 * application shell (top bar, sidebar, mobile bottom navigation).
 *
 * Every page is a thin view module on top of this file, so the chrome and the
 * data rules stay identical across desktop and mobile.
 */

/* ------------------------------------------------------------------ api --- */

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...headers } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (raw) {
    init.body = raw.body;
    init.headers['Content-Type'] = raw.type;
    if (raw.length != null) init.headers['Content-Length'] = String(raw.length);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data || {};
}

export async function uploadFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));
    xhr.send(file);
  });
}

/* --------------------------------------------------------------- session --- */

let sessionPromise = null;

export function getSession(force = false) {
  if (!sessionPromise || force) {
    sessionPromise = api('/api/auth/me')
      .then((data) => data.user || data.me || null)
      .catch(() => null);
  }
  return sessionPromise;
}

export function currentUserSync() {
  return window.__joshUser || null;
}

export async function requireAuth(nextPath) {
  const user = await getSession(true);
  if (!user) {
    const next = nextPath || location.pathname + location.search;
    location.replace(`/login?next=${encodeURIComponent(next)}`);
    return null;
  }
  return user;
}

/* ---------------------------------------------------------------- utils --- */

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatCount(n) {
  const num = Number(n) || 0;
  if (num < 1000) return String(num);
  if (num < 1_000_000) {
    const v = num / 1000;
    return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}K`;
  }
  const v = num / 1_000_000;
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}M`;
}

export function formatDuration(sec) {
  const s = Number(sec);
  if (!s || s < 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function avatarHTML(name, size = '') {
  const hue = [...String(name || '')].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  const bg = `linear-gradient(140deg, hsl(${hue} 78% 56%), hsl(${(hue + 48) % 360} 72% 44%))`;
  return `<span class="avatar ${size}" style="background:${bg}">${esc(initials(name))}</span>`;
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

/* ----------------------------------------------------------------- icons --- */

const ICONS = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/>',
  shorts: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="m10.5 8.5 4 3.5-4 3.5z"/>',
  subs: '<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="19" cy="17" r="2.5"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
  videos: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9.5 5 2.5-5 2.5z"/>',
  library: '<path d="M4 4v16M8 4v16"/><rect x="12" y="4" width="8" height="16" rx="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
  like: '<path d="M7 22V10l5-7 1.5 1a3 3 0 0 1 1 3.2L13.5 10H20a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 18.8 21H7"/><path d="M7 10H3v12h4"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/>',
  comment: '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.4-4.2A8 8 0 1 1 21 12z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  shield: '<path d="M12 3 4.5 6v6c0 5 3.4 8 7.5 9 4.1-1 7.5-4 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.5 6.5a7.5 7.5 0 0 0 0 11M17.5 17.5a7.5 7.5 0 0 0 0-11"/>',
  upload: '<path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 13 4.5 4.5L19 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="m14 6 4 4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  dollar: '<path d="M12 2v20"/><path d="M16.5 7.5A3.5 3.5 0 0 0 13 5h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a3.5 3.5 0 0 1-3.5-2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 11 5-3v8l-5-3z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  arrowLeft: '<path d="M20 12H4"/><path d="m10 6-6 6 6 6"/>',
};

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ---------------------------------------------------------------- toast --- */

export function toast(message, kind = '') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const node = document.createElement('div');
  node.className = `toast ${kind}`.trim();
  node.textContent = message;
  stack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, kind === 'error' ? 5200 : 3600);
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    scrim.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h3>${esc(title)}</h3>
        <p class="sub">${esc(body)}</p>
        <div class="modal-actions">
          <button class="btn ghost" data-no>Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(scrim);
    const close = (value) => {
      scrim.remove();
      resolve(value);
    };
    scrim.querySelector('[data-no]').addEventListener('click', () => close(false));
    scrim.querySelector('[data-yes]').addEventListener('click', () => close(true));
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) close(false);
    });
    scrim.querySelector('[data-yes]').focus();
  });
}

/* ----------------------------------------------------------------- cards --- */

const THUMB_FALLBACK = `<span class="thumb-fallback">${icon('film')}</span>`;

export function thumbURL(video) {
  return `/api/videos/${encodeURIComponent(video.id)}/thumbnail`;
}

export function videoCard(video, { horiz = false, showStatus = false, showCreator = true } = {}) {
  const thumb = video.hasThumbnail
    ? `<img src="${thumbURL(video)}" alt="" loading="lazy" decoding="async">`
    : THUMB_FALLBACK;
  const dur = formatDuration(video.durationSec);
  const status = showStatus
    ? `<span class="thumb-status ${video.status === 'draft' ? 'draft' : 'published'}">${esc(video.status)}</span>`
    : '';
  const meta = showCreator
    ? `<div class="video-sub">
         <a href="/channel?id=${encodeURIComponent(video.creator.id)}">${esc(video.creator.displayName)}</a>
         <span class="dot"></span>
         <span>${formatCount(video.views)} views</span>
         <span class="dot"></span>
         <span>${timeAgo(video.publishedAt || video.createdAt)}</span>
       </div>`
    : `<div class="video-sub">
         <span>${formatCount(video.views)} views</span>
         <span class="dot"></span>
         <span>${timeAgo(video.publishedAt || video.createdAt)}</span>
       </div>`;
  const avatar = showCreator && !horiz ? avatarHTML(video.creator.displayName) : '';
  return `
    <a class="video-card ${horiz ? 'horiz' : ''}" href="/watch?v=${encodeURIComponent(video.id)}">
      <span class="thumb">${thumb}${status}${dur ? `<span class="duration">${dur}</span>` : ''}</span>
      <div class="meta">
        ${avatar}
        <div class="meta-body">
          <div class="video-title" title="${esc(video.title)}">${esc(video.title)}</div>
          ${meta}
        </div>
      </div>
    </a>`;
}

export function renderGrid(container, videos, opts = {}) {
  container.innerHTML = videos.map((v) => videoCard(v, opts)).join('');
}

export function skeletonGrid(count = 8) {
  return Array.from({ length: count })
    .map(
      () => `
      <div>
        <div class="skeleton card"></div>
        <div class="skeleton line"></div>
        <div class="skeleton line short"></div>
      </div>`,
    )
    .join('');
}

export function emptyState({ icon: iconName = 'film', title, text, action = '' }) {
  return `
    <div class="empty">
      ${icon(iconName)}
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

export async function shareVideo(video) {
  const url = `${location.origin}/watch?v=${encodeURIComponent(video.id)}`;
  const payload = { title: video.title, text: video.title, url };
  if (navigator.share) {
    try {
      await navigator.share(payload);
      return;
    } catch {
      /* user cancelled — fall through to clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard', 'ok');
  } catch {
    toast('Copy this link: ' + url);
  }
}

/* ----------------------------------------------------------------- shell --- */

const NAV_MAIN = [
  { key: 'home', href: '/', label: 'Home', icon: 'home' },
  { key: 'shorts', href: '/shorts', label: 'Shorts', icon: 'shorts' },
  { key: 'subscriptions', href: '/subscriptions', label: 'Subscriptions', icon: 'subs' },
];

const NAV_YOU = [
  { key: 'history', href: '/history', label: 'History', icon: 'history' },
  { key: 'studio', href: '/studio', label: 'Your videos', icon: 'videos' },
  { key: 'library', href: '/library', label: 'Library', icon: 'library' },
];

function navItem(item, active, tail = '') {
  return `<a class="nav-item ${active === item.key ? 'active' : ''}" href="${item.href}">
      ${icon(item.icon)}<span class="nav-text">${item.label}</span>${tail}
    </a>`;
}

export async function mountShell({ active = '', requireUser: needsUser = false } = {}) {
  const user = await getSession(true);
  window.__joshUser = user;

  if (needsUser && !user) {
    const next = location.pathname + location.search;
    location.replace(`/login?next=${encodeURIComponent(next)}`);
    return null;
  }

  const youLinks = [
    navItem(NAV_YOU[0], active),
    navItem(NAV_YOU[1], active),
    navItem(NAV_YOU[2], active),
  ].join('');

  const studioLinks = user
    ? `
      <div class="nav-label">You</div>
      <a class="nav-item ${active === 'studio' ? 'active' : ''}" href="/studio">${icon('chart')}<span class="nav-text">Creator Studio</span></a>
      <a class="nav-item ${active === 'earnings' ? 'active' : ''}" href="/earnings">${icon('wallet')}<span class="nav-text">Earnings</span></a>
      <a class="nav-item ${active === 'live' ? 'active' : ''}" href="/live">${icon('live')}<span class="nav-text">Go live</span></a>
      ${user.role === 'admin' ? `<a class="nav-item ${active === 'admin' ? 'active' : ''}" href="/admin">${icon('shield')}<span class="nav-text">Admin</span></a>` : ''}
    `
    : '';

  const profileArea = user
    ? `<button class="avatar-btn" data-profile aria-label="Account menu">${avatarHTML(user.displayName)}</button>`
    : `<a class="btn primary sm desktop-only" href="/login">Sign in</a><a class="icon-btn mobile-only" href="/login" aria-label="Sign in">${icon('user')}</a>`;

  const chrome = `
    <header class="topbar">
      <button class="icon-btn mobile-only" data-drawer aria-label="Open menu">${icon('menu')}</button>
      <a class="brand" href="/" aria-label="JOSH home">
        <span class="brand-mark"></span><span class="brand-name">JO<b>SH</b></span>
      </a>
      <div class="topbar-mid">
        <form class="search" role="search" data-search>
          <input type="search" name="q" placeholder="Search videos, creators" aria-label="Search JOSH" autocomplete="off">
          <button type="submit" aria-label="Search">${icon('search')}</button>
        </form>
      </div>
      <div class="topbar-right">
        <a class="btn-create" href="/upload">${icon('plus')}<span>Create</span></a>
        <button class="icon-btn" data-notif aria-label="Notifications">${icon('bell')}<span class="badge-dot hidden" data-notif-dot></span></button>
        ${profileArea}
      </div>

      <div class="popover" data-notif-panel aria-label="Notifications">
        <h4>Notifications</h4>
        <div data-notif-body><div class="popover-item muted">Loading…</div></div>
      </div>

      <div class="popover" data-profile-panel aria-label="Account">
        ${
          user
            ? `<div style="padding:12px 10px 10px;display:flex;gap:10px;align-items:center">
                 ${avatarHTML(user.displayName, 'lg')}
                 <div style="min-width:0">
                   <strong class="truncate" style="display:block;font-size:14px">${esc(user.displayName)}</strong>
                   <span class="small muted">${esc(user.email || '')}</span>
                   <div class="mt-4"><span class="badge ${esc(user.role)}">${esc(user.role)}</span></div>
                 </div>
               </div>
               <div class="popover-sep"></div>
               <a class="popover-item" href="/channel?id=${encodeURIComponent(user.id)}">${icon('user')}Your channel</a>
               <a class="popover-item" href="/studio">${icon('chart')}Creator Studio</a>
               <a class="popover-item" href="/earnings">${icon('wallet')}Earnings</a>
               ${user.role === 'admin' ? `<a class="popover-item" href="/admin">${icon('shield')}Admin dashboard</a>` : ''}
               <div class="popover-sep"></div>
               <button class="popover-item" data-signout>${icon('logout')}Sign out</button>`
            : `<div style="padding:14px 10px">
                 <strong style="display:block;margin-bottom:4px">Welcome to JOSH</strong>
                 <span class="small muted">Sign in to upload, subscribe and comment.</span>
                 <a class="btn primary block mt-12" href="/login">Sign in</a>
               </div>`
        }
      </div>
    </header>

    <aside class="sidebar" aria-label="Main navigation">
      <nav class="nav-group">
        ${NAV_MAIN.map((item) => navItem(item, active)).join('')}
      </nav>
      <nav class="nav-group">
        <div class="nav-label">You</div>
        ${youLinks}
      </nav>
      ${studioLinks ? `<nav class="nav-group">${studioLinks}</nav>` : ''}
      <nav class="nav-group">
        <a class="nav-item" href="/about">${icon('info')}<span class="nav-text">About JOSH</span></a>
        <a class="nav-item" href="https://supabase.com" target="_blank" rel="noopener">${icon('external')}<span class="nav-text">Supabase</span></a>
      </nav>
      <div class="sidebar-foot">
        JOSH — creator video platform.<br>
        Revenue split 60% creator / 40% platform.<br>
        <a href="/about">How it works</a>
      </div>
    </aside>

    <div class="drawer-scrim" data-scrim></div>

    <nav class="bottom-nav" aria-label="Mobile navigation">
      <a href="/" class="${active === 'home' ? 'active' : ''}">${icon('home')}<span>Home</span></a>
      <a href="/shorts" class="${active === 'shorts' ? 'active' : ''}">${icon('shorts')}<span>Shorts</span></a>
      <a href="/upload" class="${active === 'upload' ? 'active' : ''}">${icon('plus')}<span>Create</span></a>
      <a href="/subscriptions" class="${active === 'subscriptions' ? 'active' : ''}">${icon('subs')}<span>Subs</span></a>
      <a href="${user ? '/library' : '/login'}" class="${active === 'library' ? 'active' : ''}">${icon('library')}<span>Library</span></a>
    </nav>`;

  const host = document.getElementById('app-chrome');
  if (host) host.innerHTML = chrome;
  else document.body.insertAdjacentHTML('afterbegin', chrome);

  wireShell(user);
  return user;
}

function wireShell(user) {
  const search = document.querySelector('[data-search]');
  if (search) {
    const input = search.querySelector('input');
    const current = qs('q');
    if (current) input.value = current;
    search.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      location.href = q ? `/feed?q=${encodeURIComponent(q)}` : '/';
    });
  }

  const drawerBtn = document.querySelector('[data-drawer]');
  const scrim = document.querySelector('[data-scrim]');
  if (drawerBtn) drawerBtn.addEventListener('click', () => document.body.classList.toggle('drawer-open'));
  if (scrim) scrim.addEventListener('click', () => document.body.classList.remove('drawer-open'));

  const notifBtn = document.querySelector('[data-notif]');
  const notifPanel = document.querySelector('[data-notif-panel]');
  const profileBtn = document.querySelector('[data-profile]');
  const profilePanel = document.querySelector('[data-profile-panel]');

  const closeAll = () => {
    if (notifPanel) notifPanel.classList.remove('open');
    if (profilePanel) profilePanel.classList.remove('open');
  };

  if (notifBtn && notifPanel) {
    notifBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const willOpen = !notifPanel.classList.contains('open');
      closeAll();
      if (!willOpen) return;
      notifPanel.classList.add('open');
      const body = notifPanel.querySelector('[data-notif-body]');
      if (!user) {
        body.innerHTML = `<div class="popover-item muted">Sign in to see activity on your channel.</div>
          <a class="popover-item" href="/login">${icon('user')}Sign in</a>`;
        return;
      }
      body.innerHTML = `<div class="popover-item muted">Loading…</div>`;
      try {
        const data = await api('/api/notifications');
        const items = data.notifications || [];
        body.innerHTML = items.length
          ? items
              .map(
                (n) => `<a class="notif-item" href="${esc(n.href)}">
                    <div class="notif-body">
                      <strong>${esc(n.title)}</strong>
                      <span>${esc(n.detail || '')} · ${timeAgo(n.createdAt)}</span>
                    </div>
                  </a>`,
              )
              .join('')
          : `<div class="popover-item muted">No activity yet. Comments and subscribers on your videos appear here.</div>`;
        const dot = document.querySelector('[data-notif-dot]');
        if (dot) dot.classList.add('hidden');
      } catch {
        body.innerHTML = `<div class="popover-item muted">Could not load notifications.</div>`;
      }
    });
  }

  if (profileBtn && profilePanel) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !profilePanel.classList.contains('open');
      closeAll();
      if (willOpen) profilePanel.classList.add('open');
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.popover') && !e.target.closest('[data-notif]') && !e.target.closest('[data-profile]')) {
      closeAll();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAll();
      document.body.classList.remove('drawer-open');
    }
  });

  const signout = document.querySelector('[data-signout]');
  if (signout) {
    signout.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch {
        /* ignore — cookie is cleared server-side when possible */
      }
      sessionPromise = null;
      location.href = '/';
    });
  }
}

export function setPageTitle(title) {
  document.title = title ? `${title} · JOSH` : 'JOSH — creator video platform';
}
