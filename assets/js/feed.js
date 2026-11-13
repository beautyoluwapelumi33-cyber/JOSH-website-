/**
 * JOSH — search / category results.
 * Same card vocabulary as the home feed, laid out as result rows on desktop.
 */
import {
  mountShell,
  api,
  renderGrid,
  skeletonGrid,
  emptyState,
  esc,
  icon,
  qs,
  setPageTitle,
  formatCount,
  timeAgo,
  avatarHTML,
  thumbURL,
  formatDuration,
} from './core.js';

const view = document.getElementById('view');
const query = (qs('q') || '').trim();
let category = qs('category') || 'All';
let categories = ['All'];
let sort = qs('sort') || 'recent';

view.innerHTML = `
  <div class="page-head">
    <div>
      <h1 id="result-title">${query ? `Results for “${esc(query)}”` : 'Browse videos'}</h1>
      <p id="result-count">Searching…</p>
    </div>
    <div class="row gap-8">
      <label class="small muted" for="sort">Sort</label>
      <select class="select" id="sort" style="width:auto">
        <option value="recent">Newest</option>
        <option value="views">Most viewed</option>
        <option value="oldest">Oldest</option>
      </select>
    </div>
  </div>
  <div class="chip-row" id="chips" aria-label="Filter by category"></div>
  <div class="mt-16" id="results">
    <div class="video-grid" id="grid">${skeletonGrid(6)}</div>
    <div id="empty"></div>
  </div>`;

const chips = document.getElementById('chips');
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const countEl = document.getElementById('result-count');
const sortEl = document.getElementById('sort');

sortEl.value = sort;
sortEl.addEventListener('change', () => {
  sort = sortEl.value;
  load();
});

function renderChips() {
  chips.innerHTML = categories
    .map(
      (c) =>
        `<button class="chip ${c === category ? 'active' : ''}" type="button" data-cat="${esc(c)}">${esc(c)}</button>`,
    )
    .join('');
  chips.querySelectorAll('[data-cat]').forEach((btn) =>
    btn.addEventListener('click', () => {
      category = btn.dataset.cat;
      renderChips();
      load();
    }),
  );
}

function resultRow(v) {
  return `
    <a class="result-row" href="/watch?v=${encodeURIComponent(v.id)}">
      <span class="result-thumb">
        ${v.hasThumbnail ? `<img src="${thumbURL(v)}" alt="" loading="lazy">` : `<span class="thumb-fallback">${icon('film')}</span>`}
        ${formatDuration(v.durationSec) ? `<span class="duration">${formatDuration(v.durationSec)}</span>` : ''}
      </span>
      <div class="result-body">
        <h3>${esc(v.title)}</h3>
        <div class="video-sub">
          <span>${formatCount(v.views)} views</span><span class="dot"></span><span>${timeAgo(v.publishedAt || v.createdAt)}</span>
        </div>
        <a class="result-channel" href="/channel?id=${encodeURIComponent(v.creator.id)}">
          ${avatarHTML(v.creator.displayName, 'sm')}<span>${esc(v.creator.displayName)}</span>
        </a>
        <p class="small muted clamp-2">${esc(v.description || 'No description provided.')}</p>
      </div>
    </a>`;
}

async function load() {
  try {
    const params = new URLSearchParams({ limit: '48', sort });
    if (query) params.set('q', query);
    if (category !== 'All') params.set('category', category);
    const data = await api(`/api/videos?${params.toString()}`);
    if (Array.isArray(data.categories) && data.categories.length && categories.length === 1) {
      categories = ['All', ...data.categories];
      renderChips();
    }
    const videos = data.videos || [];
    countEl.textContent = `${videos.length} video${videos.length === 1 ? '' : 's'}${category !== 'All' ? ` in ${category}` : ''}`;
    empty.innerHTML = '';
    if (!videos.length) {
      grid.innerHTML = '';
      empty.innerHTML = emptyState({
        icon: 'search',
        title: query ? 'No videos matched that search' : 'Nothing here yet',
        text: query
          ? 'Try a different word, or clear the filters to see everything on JOSH.'
          : 'Videos published on JOSH will appear here.',
        action: '<a class="btn ghost" href="/">Back to home</a>',
      });
      return;
    }
    grid.className = 'results-list';
    grid.innerHTML = videos.map(resultRow).join('');
  } catch (err) {
    grid.innerHTML = '';
    empty.innerHTML = emptyState({
      icon: 'info',
      title: 'Could not load results',
      text: err.message,
      action: '<button class="btn ghost" type="button" onclick="location.reload()">Try again</button>',
    });
  }
}

(async function init() {
  setPageTitle(query ? `Search: ${query}` : 'Browse');
  await mountShell({ active: 'home' });
  try {
    const data = await api('/api/categories');
    if (Array.isArray(data.categories) && data.categories.length) {
      categories = ['All', ...data.categories];
    }
  } catch {
    /* All-only chips */
  }
  renderChips();
  load();
})();
