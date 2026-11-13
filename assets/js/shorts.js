/**
 * JOSH — Shorts: a vertical, scroll-snapped player for real uploads of 60s or
 * less. Shorts are ordinary videos filtered by real duration, not a mock feed.
 */
import {
  mountShell,
  api,
  esc,
  icon,
  qs,
  setPageTitle,
  formatCount,
  emptyState,
  avatarHTML,
  toast,
  shareVideo,
} from './core.js';

const view = document.getElementById('view');
const focusId = qs('v') || '';

view.innerHTML = `<div class="skeleton card" style="height:60vh"></div>`;

function slide(v, index) {
  return `
    <article class="short-slide" data-id="${esc(v.id)}" data-index="${index}">
      <video class="short-video" src="/api/videos/${encodeURIComponent(v.id)}/file"
        ${v.hasThumbnail ? `poster="/api/videos/${encodeURIComponent(v.id)}/thumbnail"` : ''}
        playsinline muted loop preload="metadata"></video>
      <div class="short-overlay">
        <div class="short-info">
          <div class="row gap-8">
            <a href="/channel?id=${encodeURIComponent(v.creator.id)}">${avatarHTML(v.creator.displayName, 'sm')}</a>
            <a href="/channel?id=${encodeURIComponent(v.creator.id)}"><strong>${esc(v.creator.displayName)}</strong></a>
          </div>
          <p>${esc(v.title)}</p>
          <span class="small muted">${formatCount(v.views)} views · ${v.category ? esc(v.category) : 'Short'}</span>
        </div>
        <div class="short-actions">
          <button class="action-btn" data-like="${esc(v.id)}" aria-label="Like">${icon('like')}<span data-like-count="${esc(v.id)}">${formatCount(v.likes)}</span></button>
          <button class="action-btn" data-share="${esc(v.id)}" aria-label="Share">${icon('share')}</button>
          <a class="action-btn" href="/watch?v=${encodeURIComponent(v.id)}" aria-label="Open comments">${icon('comment')}<span>${formatCount(v.comments)}</span></a>
        </div>
      </div>
    </article>`;
}

async function load() {
  try {
    const data = await api('/api/videos?shorts=1&limit=24');
    const items = data.videos || [];
    if (!items.length) {
      view.innerHTML = emptyState({
        icon: 'shorts',
        title: 'No Shorts yet',
        text: 'Upload a video of 60 seconds or less and it appears here automatically.',
        action: '<a class="btn primary" href="/upload">Upload a Short</a>',
      });
      return;
    }
    setPageTitle('Shorts');
    const ordered = focusId
      ? [...items].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0))
      : items;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>${icon('shorts')} Shorts</h1><p>${items.length} short video${items.length === 1 ? '' : 's'} of 60 seconds or less.</p></div>
        <a class="btn ghost sm" href="/upload">${icon('upload')}Upload a Short</a>
      </div>
      <div class="shorts-wrap">
        <div class="shorts-col" id="col">${ordered.map(slide).join('')}</div>
        <aside class="shorts-side desktop-only">
          <div class="panel" style="padding:18px">
            <h3 class="section-title">${icon('info')}About Shorts</h3>
            <p class="small muted">Shorts are your regular JOSH uploads with a duration of 60 seconds or less. They play in a vertical, scroll-snapped feed and still count real views, likes and comments.</p>
            <a class="btn ghost sm mt-12" href="/upload">${icon('plus')}Create a Short</a>
          </div>
        </aside>
      </div>`;

    const col = document.getElementById('col');
    const videos = [...col.querySelectorAll('video')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const video = entry.target;
          if (entry.isIntersecting) {
            video.play().catch(() => {});
            if (!video.dataset.counted) {
              video.dataset.counted = '1';
              const id = video.closest('.short-slide').dataset.id;
              api(`/api/videos/${encodeURIComponent(id)}/view`, { method: 'POST' }).catch(() => {});
            }
          } else {
            video.pause();
          }
        }
      },
      { threshold: 0.6 },
    );
    videos.forEach((v) => io.observe(v));

    col.querySelectorAll('[data-like]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.like;
        const active = btn.classList.contains('active');
        try {
          const data = await api(`/api/videos/${encodeURIComponent(id)}/like`, {
            method: active ? 'DELETE' : 'POST',
          });
          btn.classList.toggle('active', !active);
          const count = data.likes != null ? data.likes : data.likeCount;
          const label = col.querySelector(`[data-like-count="${id}"]`);
          if (count != null && label) label.textContent = formatCount(count);
        } catch (err) {
          if (err.status === 401) {
            location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
            return;
          }
          toast(err.message, 'error');
        }
      });
    });

    col.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = items.find((x) => x.id === btn.dataset.share);
        if (v) shareVideo(v);
      });
    });
  } catch (err) {
    view.innerHTML = emptyState({
      icon: 'info',
      title: 'Could not load Shorts',
      text: err.message,
      action: '<a class="btn ghost" href="/">Back to home</a>',
    });
  }
}

(async function init() {
  await mountShell({ active: 'shorts' });
  load();
})();
