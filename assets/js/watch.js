/**
 * JOSH — watch page: large player, creator row, subscribe, like, share,
 * comments and a related-videos rail. Views are counted by the server when
 * playback actually starts; nothing is pre-incremented.
 */
import {
  mountShell,
  api,
  esc,
  icon,
  qs,
  setPageTitle,
  formatCount,
  timeAgo,
  formatDate,
  avatarHTML,
  shareVideo,
  toast,
  emptyState,
  videoCard,
  thumbURL,
} from './core.js';

const view = document.getElementById('view');
const videoId = qs('v') || '';
let detail = null;
let channel = null;
let viewCounted = false;

if (!videoId) {
  view.innerHTML = emptyState({
    icon: 'play',
    title: 'No video selected',
    text: 'Pick a video from the feed to start watching.',
    action: '<a class="btn primary" href="/">Browse videos</a>',
  });
} else {
  view.innerHTML = `<div class="watch-layout"><div><div class="skeleton card" style="aspect-ratio:16/9"></div></div></div>`;
}

function commentHTML(c) {
  return `
    <div class="comment">
      ${avatarHTML(c.author, 'sm')}
      <div class="c-body">
        <div class="c-head"><strong>${esc(c.author)}</strong><span class="small muted">${timeAgo(c.createdAt)}</span></div>
        <p>${esc(c.body)}</p>
      </div>
    </div>`;
}

function renderRelated(items) {
  return items
    .filter((v) => v.id !== videoId)
    .map((v) => videoCard(v, { horiz: true }))
    .join('');
}

async function load() {
  try {
    detail = await api(`/api/videos/${encodeURIComponent(videoId)}`);
  } catch (err) {
    view.innerHTML = emptyState({
      icon: 'info',
      title: err.status === 404 ? 'Video unavailable' : 'Could not load this video',
      text: err.status === 404 ? 'It may have been removed, or it is still a draft.' : err.message,
      action: '<a class="btn primary" href="/">Back to home</a>',
    });
    return;
  }

  const v = detail.video;
  setPageTitle(v.title);
  channel = await api(`/api/channels/${encodeURIComponent(v.creator.id)}`).catch(() => null);
  const related = await api('/api/videos?limit=14').catch(() => ({ videos: [] }));

  const subCount = channel ? channel.channel.subscriberCount : 0;
  const subscribed = channel ? channel.subscribed : false;
  const isOwner = channel ? channel.isOwner : false;

  view.innerHTML = `
    <div class="watch-layout">
      <div class="watch-main">
        <div class="player-wrap">
          <video id="player" controls playsinline preload="metadata" poster="${v.hasThumbnail ? thumbURL(v) : ''}">
            <source src="${detail.streamUrl}" type="${esc(v.mime || 'video/mp4')}">
            Your browser cannot play this video.
          </video>
        </div>

        <h1 class="watch-title">${esc(v.title)}</h1>

        <div class="watch-bar">
          <div class="creator-line">
            <a href="/channel?id=${encodeURIComponent(v.creator.id)}" class="channel-inline">
              ${avatarHTML(v.creator.displayName, 'md')}
              <span>
                <strong>${esc(v.creator.displayName)}</strong>
                <span class="small muted">${formatCount(subCount)} subscriber${subCount === 1 ? '' : 's'}</span>
              </span>
            </a>
            ${
              isOwner
                ? `<a class="btn ghost sm" href="/studio">${icon('chart')}Manage</a>`
                : `<button class="btn ${subscribed ? 'ghost subscribed' : 'primary'} sm" id="subscribe">
                     ${subscribed ? `${icon('check')}Subscribed` : 'Subscribe'}
                   </button>`
            }
          </div>

          <div class="watch-actions">
            <button class="action-btn ${detail.liked ? 'active' : ''}" id="like">
              ${icon('like')}<span id="like-count">${formatCount(v.likes)}</span>
            </button>
            <button class="action-btn" id="share">${icon('share')}<span>Share</span></button>
          </div>
        </div>

        <div class="desc-box">
          <div class="desc-meta">
            <strong>${formatCount(v.views)} views</strong>
            <span class="dot"></span>
            <span>${formatDate(v.publishedAt || v.createdAt)}</span>
            ${v.category ? `<span class="pill">${esc(v.category)}</span>` : ''}
            ${v.status !== 'published' ? `<span class="pill warn">${esc(v.status)}</span>` : ''}
          </div>
          <p id="description">${esc(v.description || 'No description provided.')}</p>
        </div>

        <section class="comments">
          <div class="comments-head">
            <h3>${v.comments} comment${v.comments === 1 ? '' : 's'}</h3>
          </div>
          <form class="comment-form" id="comment-form">
            <textarea class="textarea" name="body" rows="2" maxlength="1200" placeholder="Add a comment…" aria-label="Add a comment"></textarea>
            <div class="row-actions">
              <button class="btn primary sm" type="submit">Comment</button>
            </div>
          </form>
          <div id="comment-list">
            ${(detail.comments || []).map(commentHTML).join('') || '<p class="small muted">No comments yet. Be the first to comment.</p>'}
          </div>
        </section>
      </div>

      <aside class="related">
        <h3 class="section-title">${icon('grid')}Up next</h3>
        <div id="related-list" class="mt-8">
          ${(related.videos || []).length ? renderRelated(related.videos) : '<p class="small muted">No other videos published yet.</p>'}
        </div>
      </aside>
    </div>`;

  /* ---- player: count a real view once playback begins ---- */
  const player = document.getElementById('player');
  player.addEventListener(
    'play',
    async () => {
      if (viewCounted) return;
      viewCounted = true;
      try {
        const data = await api(`/api/videos/${encodeURIComponent(v.id)}/view`, { method: 'POST' });
        const meta = view.querySelector('.desc-meta strong');
        if (meta) meta.textContent = `${formatCount(data.views)} views`;
      } catch {
        /* view counting is best-effort and never blocks playback */
      }
    },
    { once: true },
  );

  /* ---- like ---- */
  const likeBtn = document.getElementById('like');
  likeBtn.addEventListener('click', async () => {
    const active = likeBtn.classList.contains('active');
    likeBtn.disabled = true;
    try {
      const data = await api(`/api/videos/${encodeURIComponent(v.id)}/like`, {
        method: active ? 'DELETE' : 'POST',
      });
      likeBtn.classList.toggle('active', !active);
      const count = data.likes != null ? data.likes : data.likeCount;
      if (count != null) document.getElementById('like-count').textContent = formatCount(count);
    } catch (err) {
      if (err.status === 401) {
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      toast(err.message, 'error');
    } finally {
      likeBtn.disabled = false;
    }
  });

  /* ---- share ---- */
  document.getElementById('share').addEventListener('click', () => shareVideo(v));

  /* ---- subscribe ---- */
  const subBtn = document.getElementById('subscribe');
  if (subBtn) {
    subBtn.addEventListener('click', async () => {
      const subscribing = !subBtn.classList.contains('subscribed');
      subBtn.disabled = true;
      try {
        await api(`/api/channels/${encodeURIComponent(v.creator.id)}/subscribe`, {
          method: subscribing ? 'POST' : 'DELETE',
        });
        subBtn.className = `btn ${subscribing ? 'ghost subscribed' : 'primary'} sm`;
        subBtn.innerHTML = subscribing ? `${icon('check')}Subscribed` : 'Subscribe';
        toast(subscribing ? 'Subscribed' : 'Unsubscribed', 'ok');
      } catch (err) {
        if (err.status === 401) {
          location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
          return;
        }
        toast(err.message, 'error');
      } finally {
        subBtn.disabled = false;
      }
    });
  }

  /* ---- comments ---- */
  const form = document.getElementById('comment-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      await api(`/api/videos/${encodeURIComponent(v.id)}/comments`, { method: 'POST', body: { body } });
      const fresh = await api(`/api/videos/${encodeURIComponent(v.id)}`);
      document.getElementById('comment-list').innerHTML =
        (fresh.comments || []).map(commentHTML).join('') ||
        '<p class="small muted">No comments yet. Be the first to comment.</p>';
      form.reset();
      const heading = view.querySelector('.comments-head h3');
      if (heading) heading.textContent = `${fresh.video.comments} comment${fresh.video.comments === 1 ? '' : 's'}`;
      toast('Comment posted', 'ok');
    } catch (err) {
      if (err.status === 401) {
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });
}

(async function init() {
  await mountShell({ active: 'home' });
  if (videoId) load();
})();
