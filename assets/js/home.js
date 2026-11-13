/**
 * JOSH — home feed: category chips, Shorts shelf and the responsive video grid.
 * All content comes from the API; an empty platform shows onboarding, never
 * placeholder videos.
 */
import {
  mountShell,
  api,
  renderGrid,
  skeletonGrid,
  emptyState,
  esc,
  icon,
  formatCount,
  setPageTitle,
  toast,
} from './core.js';

const view = document.getElementById('view');
let categories = ['All'];
let activeCategory = 'All';

view.innerHTML = `
  <div class="chip-row" id="chips" aria-label="Categories"></div>
  <section id="shorts-shelf" class="mt-16"></section>
  <div id="feed-region" class="mt-16">
    <div class="video-grid" id="grid">${skeletonGrid(8)}</div>
  </div>
  <div id="feed-empty" class="mt-24"></div>
`;

const chips = document.getElementById('chips');
const grid = document.getElementById('grid');
const feedRegion = document.getElementById('feed-region');
const feedEmpty = document.getElementById('feed-empty');
const shelf = document.getElementById('shorts-shelf');

function renderChips() {
  chips.innerHTML = categories
    .map(
      (c) =>
        `<button class="chip ${c === activeCategory ? 'active' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`,
    )
    .join('');
  chips.querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderChips();
      loadFeed();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

async function loadCategories() {
  try {
    const data = await api('/api/categories');
    if (Array.isArray(data.categories) && data.categories.length) {
      categories = ['All', ...data.categories];
    }
  } catch {
    /* keep the All-only row */
  }
  renderChips();
}

function onboarding() {
  return `
    <div class="panel" style="padding:28px">
      <div class="hero" style="margin:0">
        <span class="pill accent">${icon('play')} JOSH is ready</span>
        <h1>Your video platform starts here</h1>
        <p class="sub">No videos have been published yet. This feed shows real uploads only — nothing here is simulated.</p>
        <div class="hero-actions">
          <a class="btn primary" href="/upload">${icon('upload')} Upload a video</a>
          <a class="btn ghost" href="/signup">Create an account</a>
        </div>
      </div>
      <div class="feature-grid mt-24">
        <div class="feature">
          <span class="ico">${icon('upload')}</span>
          <strong>Upload and publish</strong>
          <p class="small muted">Upload an MP4 or WebM, add a thumbnail and publish when you are ready.</p>
        </div>
        <div class="feature">
          <span class="ico">${icon('chart')}</span>
          <strong>Real analytics</strong>
          <p class="small muted">Creator Studio counts actual views, likes and comments on your videos.</p>
        </div>
        <div class="feature">
          <span class="ico">${icon('wallet')}</span>
          <strong>60% creator share</strong>
          <p class="small muted">Earnings reflect payments an admin records, split 60/40 in your favour.</p>
        </div>
      </div>
    </div>`;
}

async function loadShorts() {
  try {
    const data = await api('/api/videos?shorts=1&limit=12');
    const items = data.videos || [];
    if (!items.length) {
      shelf.innerHTML = '';
      return;
    }
    shelf.innerHTML = `
      <div class="section-title">${icon('shorts')} Shorts</div>
      <div class="shorts-rail">
        ${items
          .map(
            (v) => `
            <a class="short-card" href="/shorts?v=${encodeURIComponent(v.id)}">
              <span class="thumb">${
                v.hasThumbnail
                  ? `<img src="/api/videos/${encodeURIComponent(v.id)}/thumbnail" alt="" loading="lazy">`
                  : `<span class="thumb-fallback">${icon('film')}</span>`
              }</span>
              <strong class="truncate">${esc(v.title)}</strong>
              <span class="small muted">${formatCount(v.views)} views</span>
            </a>`,
          )
          .join('')}
      </div>`;
  } catch {
    shelf.innerHTML = '';
  }
}

async function loadFeed() {
  feedEmpty.innerHTML = '';
  if (!grid.children.length || !grid.querySelector('.video-card')) {
    grid.innerHTML = skeletonGrid(8);
  }
  try {
    const query = activeCategory === 'All' ? '' : `&category=${encodeURIComponent(activeCategory)}`;
    const data = await api(`/api/videos?limit=24${query}`);
    const videos = data.videos || [];
    if (!videos.length) {
      feedRegion.classList.add('hidden');
      feedEmpty.innerHTML =
        activeCategory === 'All'
          ? onboarding()
          : emptyState({
              icon: 'film',
              title: `Nothing in ${activeCategory} yet`,
              text: 'When creators publish videos in this category they will appear here.',
              action: `<button class="btn ghost" type="button" onclick="location.reload()">Show all videos</button>`,
            });
      return;
    }
    feedRegion.classList.remove('hidden');
    renderGrid(grid, videos);
  } catch (err) {
    feedRegion.classList.add('hidden');
    feedEmpty.innerHTML = emptyState({
      icon: 'info',
      title: 'Could not load the feed',
      text: err.message,
      action: '<button class="btn ghost" type="button" onclick="location.reload()">Try again</button>',
    });
  }
}

(async function init() {
  setPageTitle('Home');
  const user = await mountShell({ active: 'home' });
  await loadCategories();
  loadShorts();
  loadFeed();

  if (!user) {
    const note = document.querySelector('[data-welcome-note]');
    if (note) note.textContent = '';
  }
})();
