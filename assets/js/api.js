/* Shared client helpers: API access, session state and header rendering. */

export const state = { user: null };

export async function api(path, options = {}) {
  const { method = 'GET', body, headers = {}, raw = false } = options;
  const init = { method, credentials: 'same-origin', headers: { ...headers } };

  if (body !== undefined && body !== null) {
    if (raw) {
      init.body = body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  const response = await fetch(path, init);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }

  if (!response.ok) {
    const error = new Error((data && data.error) || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data || {};
    throw error;
  }
  return data;
}

export async function loadSession() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user || null;
  } catch {
    state.user = null;
  }
  return state.user;
}

export function money(value) {
  const n = Number(value || 0);
  return `${n.toFixed(2)} USDT`;
}

export function compact(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(id) {
  return document.getElementById(id);
}

export function statusPill(status) {
  const safe = String(status || '').toLowerCase();
  return `<span class="pill ${safe}">${escapeHtml(safe)}</span>`;
}

export function notice(target, message, kind = '') {
  const node = typeof target === 'string' ? el(target) : target;
  if (!node) return;
  node.className = `notice ${kind}`.trim();
  node.innerHTML = message;
  node.hidden = false;
}

/** Render the session-aware part of the navigation. */
export function mountHeader(active = '') {
  const slot = el('nav-auth');
  const links = document.querySelectorAll('.nav-links a');
  links.forEach((link) => {
    if (link.getAttribute('href') === active) link.setAttribute('aria-current', 'page');
  });
  if (!slot) return;

  const user = state.user;
  if (!user) {
    slot.innerHTML = `
      <a class="button ghost small" href="/login">Sign in</a>
      <a class="nav-button" href="/signup">Join JOSH</a>
    `;
    return;
  }

  slot.innerHTML = `
    <a class="button ghost small" href="/upload">Upload</a>
    ${user.role === 'admin' ? '<a class="button ghost small" href="/admin">Admin</a>' : ''}
    <span class="pill">${escapeHtml(user.role)}</span>
    <span class="small muted nowrap">${escapeHtml(user.displayName)}</span>
    <button class="button ghost small" type="button" id="sign-out">Sign out</button>
  `;

  const signOut = el('sign-out');
  if (signOut) {
    signOut.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      state.user = null;
      window.location.href = '/';
    });
  }
}

/** Send anonymous visitors to the sign-in page, preserving where they were. */
export async function requireUser() {
  await loadSession();
  mountHeader(document.body.dataset.nav || '');
  if (!state.user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    return null;
  }
  return state.user;
}

export async function initPage() {
  await loadSession();
  mountHeader(document.body.dataset.nav || '');
  return state.user;
}
