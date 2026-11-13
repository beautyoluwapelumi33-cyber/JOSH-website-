/**
 * JOSH — signed-in browse views: Subscriptions, History and Library.
 * One module, selected by <body data-view>. Everything listed here is real
 * data for the signed-in account: no suggested or invented content.
 */
import {
  mountShell,
  api,
  renderGrid,
  emptyState,
  esc,
  icon,
  setPageTitle,
  formatCount,
  timeAgo,
  avatarHTML,
  thumbURL,
  formatDuration,
  toast,
} from './core.js';

const view = document.getElementById('view');
const mode = document.body.dataset.view || 'subscriptions';

function head(title, sub, right = '') {
  return `<div class="page-head">
      <div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
      <div class="row gap-8">${right}</div>
    </div>`;
}

function signInPrompt(title, text) {
  return emptyState({
    icon: 'user',
    title,
    text,
    action: `<a class="btn primary" href="/login?next=${encodeURIComponent(location.pathname)}">Sign in</a>
             <a class="btn ghost" href="/signup">Create account</a>`,
  });
}

function historyRow(v) {
  return `
    <a class="result-row" href="/watch?v=${encodeURIComponent(v.id)}">
      <span class="result-thumb">
        ${v.hasThumbnail ? `<img src="${thumbURL(v)}" alt="" loading="lazy">` : `<span class="thumb-fallback">${icon('film')}</span>`}
        ${formatDuration(v.durationSec) ? `<span class="duration">${formatDuration(v.durationSec)}</span>` : ''}
      </span>
      <div class="result-body">
        <h3>${esc(v.title)}</h3>
        <div class="video-sub">
          <a href="/channel?id=${encodeURIComponent(v.creator.id)}">${esc(v.creator.displayName)}</a>
          <span class="dot"></span><span>${formatCount(v.views)} views</span>
        </div>
        <p class="small muted">Watched ${timeAgo(v.watchedAt)}</p>
      </div>
    </a>`;
}

async function renderSubscriptions(user) {
  setPageTitle('Subscriptions');
  view.innerHTML = head('Subscriptions', 'Latest uploads from channels you follow.');
  const region = document.createElement('div');
  view.appendChild(region);
  const data = await api('/api/subscriptions');
  const videos = data.videos || [];
  const channels = data.channels || [];

  if (!channels.length) {
    region.innerHTML = emptyState({
      icon: 'subs',
      title: 'No subscriptions yet',
      text: 'Subscribe to creators and their newest videos will collect here.',
      action: '<a class="btn primary" href="/">Discover videos</a>',
    });
    return;
  }

  region.innerHTML = `
    <div class="chip-row">
      ${channels
        .map(
          (c) => `<a class="channel-chip" href="/channel?id=${encodeURIComponent(c.id)}">
            ${avatarHTML(c.displayName, 'sm')}<span>${esc(c.displayName)}</span>
          </a>`,
        )
        .join('')}
    </div>
    <div class="video-grid mt-16" id="grid"></div>`;
  if (videos.length) renderGrid(document.getElementById('grid'), videos);
  else {
    document.getElementById('grid').outerHTML = emptyState({
      icon: 'film',
      title: 'No uploads from your channels yet',
      text: 'When the creators you follow publish something, it appears here.',
    });
  }
}

async function renderHistory(user) {
  setPageTitle('History');
  view.innerHTML = head(
    'Watch history',
    'Videos you watched while signed in.',
    '<button class="btn ghost sm" id="clear-history">' + icon('trash') + 'Clear history</button>',
  );
  const region = document.createElement('div');
  view.appendChild(region);
  const data = await api('/api/history');
  const videos = data.videos || [];
  if (!videos.length) {
    region.innerHTML = emptyState({
      icon: 'history',
      title: 'No watch history yet',
      text: 'Videos you open while signed in are listed here.',
      action: '<a class="btn primary" href="/">Browse videos</a>',
    });
    return;
  }
  region.innerHTML = `<div class="results-list">${videos.map(historyRow).join('')}</div>`;
  const clear = document.getElementById('clear-history');
  if (clear) {
    clear.addEventListener('click', async () => {
      try {
        await api('/api/history', { method: 'DELETE' });
        toast('Watch history cleared', 'ok');
        renderHistory(user);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

async function renderLibrary(user) {
  setPageTitle('Library');
  view.innerHTML = head('Library', 'Your videos, subscriptions and recent activity.');
  const region = document.createElement('div');
  view.appendChild(region);
  const [studio, history, subs] = await Promise.all([
    api('/api/studio/summary').catch(() => ({ videos: [] })),
    api('/api/history').catch(() => ({ videos: [] })),
    api('/api/subscriptions').catch(() => ({ channels: [] })),
  ]);
  const mine = studio.videos || [];
  const watched = history.videos || [];
  const channels = subs.channels || [];

  region.innerHTML = `
    <div class="library-grid">
      <a class="panel library-card" href="/studio">
        <span class="ico">${icon('videos')}</span>
        <strong>Your videos</strong>
        <span class="small muted">${mine.length} video${mine.length === 1 ? '' : 's'} · ${mine.filter((v) => v.status === 'published').length} published</span>
      </a>
      <a class="panel library-card" href="/history">
        <span class="ico">${icon('history')}</span>
        <strong>Watch history</strong>
        <span class="small muted">${watched.length} recent video${watched.length === 1 ? '' : 's'}</span>
      </a>
      <a class="panel library-card" href="/subscriptions">
        <span class="ico">${icon('subs')}</span>
        <strong>Subscriptions</strong>
        <span class="small muted">${channels.length} channel${channels.length === 1 ? '' : 's'}</span>
      </a>
      <a class="panel library-card" href="/earnings">
        <span class="ico">${icon('wallet')}</span>
        <strong>Earnings</strong>
        <span class="small muted">60% creator revenue share</span>
      </a>
    </div>

    <div class="section-title mt-24">${icon('videos')}Recently watched</div>
    ${
      watched.length
        ? `<div class="results-list mt-8">${watched.slice(0, 6).map(historyRow).join('')}</div>`
        : `<p class="small muted mt-8">Nothing watched yet.</p>`
    }

    <div class="section-title mt-24">${icon('videos')}Your videos</div>
    ${
      mine.length
        ? `<div class="video-grid dense mt-8" id="mine"></div>`
        : `<p class="small muted mt-8">You have not uploaded a video yet. <a href="/upload">Upload one</a>.</p>`
    }`;
  if (mine.length) renderGrid(document.getElementById('mine'), mine, { showStatus: true });
}

(async function init() {
  const user = await mountShell({ active: mode });
  if (!user) {
    view.innerHTML = signInPrompt(
      mode === 'history' ? 'Sign in to see your history' : mode === 'library' ? 'Sign in to open your library' : 'Sign in to see subscriptions',
      'Your account keeps your history, subscriptions and library together.',
    );
    return;
  }
  try {
    if (mode === 'history') await renderHistory(user);
    else if (mode === 'library') await renderLibrary(user);
    else await renderSubscriptions(user);
  } catch (err) {
    view.innerHTML = emptyState({
      icon: 'info',
      title: 'Could not load this page',
      text: err.message,
      action: '<button class="btn ghost" type="button" onclick="location.reload()">Try again</button>',
    });
  }
})();
