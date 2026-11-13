/**
 * JOSH — Creator Studio.
 * Real per-video numbers from /api/studio/summary. Publishing, deleting and
 * navigation all go through the existing endpoints; no metric is simulated.
 */
import {
  mountShell,
  api,
  esc,
  icon,
  toast,
  confirmDialog,
  setPageTitle,
  formatCount,
  timeAgo,
  formatDuration,
  thumbURL,
  emptyState,
  requireAuth,
} from './core.js';

const view = document.getElementById('view');

function kpi(label, value, hint) {
  return `<div class="kpi">
    <span class="kpi-label">${esc(label)}</span>
    <strong class="kpi-value">${esc(value)}</strong>
    ${hint ? `<span class="kpi-hint">${esc(hint)}</span>` : ''}
  </div>`;
}

function chart(days) {
  const max = Math.max(1, ...days.map((d) => d.views));
  return `<div class="chart-bars" role="img" aria-label="Views per day over the last 14 days">
    ${days
      .map((d) => {
        const h = Math.round((d.views / max) * 100);
        const day = new Date(d.date + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return `<div class="bar-col" title="${esc(day)} — ${d.views} view${d.views === 1 ? '' : 's'}">
          <span class="bar-fill" style="height:${Math.max(d.views > 0 ? 4 : 1, h)}%"></span>
          <span class="bar-day">${esc(day.split(' ')[1] || '')}</span>
        </div>`;
      })
      .join('')}
  </div>`;
}

function statusPill(status) {
  return `<span class="pill ${status === 'published' ? 'ok' : 'warn'}">${esc(status)}</span>`;
}

function row(v) {
  const thumb = thumbURL(v.id, v.hasThumbnail);
  return `<tr data-video="${esc(v.id)}">
    <td class="cell-video">
      <a class="row-video" href="/watch?v=${esc(v.id)}">
        <span class="thumb-mini">${thumb ? `<img src="${esc(thumb)}" alt="">` : `<span class="thumb-mini-empty">${icon('film', 16)}</span>`}
          ${v.durationSec ? `<span class="thumb-time">${formatDuration(v.durationSec)}</span>` : ''}
        </span>
        <span class="row-meta">
          <span class="row-title">${esc(v.title)}</span>
          <span class="row-sub">${esc(v.category || 'Other')} · ${esc(timeAgo(v.publishedAt || v.createdAt))}</span>
        </span>
      </a>
    </td>
    <td>${statusPill(v.status)}</td>
    <td class="num">${formatCount(v.views)}</td>
    <td class="num">${formatCount(v.likes)}</td>
    <td class="num">${formatCount(v.comments)}</td>
    <td class="cell-actions">
      ${v.status === 'draft' ? `<button class="btn sm primary" data-publish="${esc(v.id)}">Publish</button>` : ''}
      <a class="btn sm ghost" href="/watch?v=${esc(v.id)}">View</a>
      <button class="btn sm danger" data-delete="${esc(v.id)}" aria-label="Delete ${esc(v.title)}">${icon('trash', 15)}</button>
    </td>
  </tr>`;
}

async function load() {
  const user = await requireAuth();
  if (!user) return;
  setPageTitle('Creator Studio');

  view.innerHTML = `<div class="page-head">
      <div>
        <h1>Creator Studio</h1>
        <p class="sub">Everything you have uploaded, with the numbers it actually earned.</p>
      </div>
      <div class="page-actions">
        <a class="btn ghost" href="/earnings">${icon('wallet', 16)} Earnings</a>
        <a class="btn primary" href="/upload">${icon('upload', 16)} Upload video</a>
      </div>
    </div>
    <div class="skeleton-block"></div>`;

  let data;
  try {
    data = await api('/api/studio/summary');
  } catch (err) {
    view.innerHTML = `<div class="page-head"><h1>Creator Studio</h1></div>`;
    view.appendChild(emptyState({ icon: 'alert', title: 'Could not load your studio', text: err.message }));
    return;
  }

  const t = data.totals || {};
  const videos = data.videos || [];
  const days = data.dailyViews || [];

  view.innerHTML = `<div class="page-head">
      <div>
        <h1>Creator Studio</h1>
        <p class="sub">Everything you have uploaded, with the numbers it actually earned.</p>
      </div>
      <div class="page-actions">
        <a class="btn ghost" href="/earnings">${icon('wallet', 16)} Earnings</a>
        <a class="btn primary" href="/upload">${icon('upload', 16)} Upload video</a>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpi('Videos', formatCount(t.videos || 0), `${t.published || 0} published`)}
      ${kpi('Views', formatCount(t.views || 0), 'all time')}
      ${kpi('Likes', formatCount(t.likes || 0), 'all time')}
      ${kpi('Comments', formatCount(t.comments || 0), 'all time')}
      ${kpi('Drafts', formatCount(t.drafts || 0), 'not public yet')}
    </div>

    <section class="card pad">
      <div class="card-head">
        <h2>Views — last 14 days</h2>
        <span class="muted small">${formatCount(days.reduce((n, d) => n + d.views, 0))} views in this period</span>
      </div>
      ${chart(days)}
    </section>

    <section class="card">
      <div class="card-head pad-x">
        <h2>Your videos</h2>
        <span class="muted small">${videos.length} total</span>
      </div>
      ${
        videos.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr>
                <th>Video</th><th>Status</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Comments</th><th></th>
              </tr></thead>
              <tbody>${videos.map(row).join('')}</tbody>
            </table></div>`
          : emptyState({
              icon: 'film',
              title: 'No videos yet',
              text: 'Upload your first video and this table fills with real views, likes and comments.',
              action: `<a class="btn primary" href="/upload">Upload a video</a>`,
            })
      }
    </section>`;

  view.addEventListener('click', async (e) => {
    const publishId = e.target.closest('[data-publish]')?.dataset.publish;
    const deleteId = e.target.closest('[data-delete]')?.dataset.delete;

    if (publishId) {
      try {
        await api(`/api/videos/${publishId}/publish`, { method: 'POST' });
        toast('Video published');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if (deleteId) {
      const ok = await confirmDialog({
        title: 'Delete this video?',
        text: 'The video and its thumbnail are removed permanently. Views and comments on it are lost.',
        confirmText: 'Delete video',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/videos/${deleteId}`, { method: 'DELETE' });
        toast('Video deleted');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

mountShell({ view: 'studio' });
load();
