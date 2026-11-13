/**
 * JOSH — channel page: banner, identity, subscribe, tabs and category
 * collections. Counts are real (subscribers, views, published videos).
 */
import {
  mountShell,
  api,
  getSession,
  renderGrid,
  skeletonGrid,
  emptyState,
  esc,
  icon,
  qs,
  setPageTitle,
  formatCount,
  formatDate,
  avatarHTML,
  toast,
  confirmDialog,
} from './core.js';

const view = document.getElementById('view');
let channelId = qs('id') || '';
let me = null;

view.innerHTML = `<div class="skeleton card" style="height:220px"></div>`;

function bannerHTML(name) {
  const hue = [...String(name || '')].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  return `<div class="channel-banner" style="background:
      radial-gradient(80% 140% at 12% 0%, hsl(${hue} 70% 42% / .75), transparent 60%),
      radial-gradient(90% 120% at 92% 20%, rgba(255,45,120,.55), transparent 62%),
      linear-gradient(120deg, #14141d, #1d1d2a)"></div>`;
}

async function load() {
  if (!channelId && me) channelId = me.id;
  if (!channelId) {
    view.innerHTML = emptyState({
      icon: 'user',
      title: 'No channel selected',
      text: 'Open a creator from any video, or sign in to see your own channel.',
      action: '<a class="btn primary" href="/login">Sign in</a>',
    });
    return;
  }

  try {
    const data = await api(`/api/channels/${encodeURIComponent(channelId)}`);
    const c = data.channel;
    const videos = data.videos || [];
    const collections = data.collections || [];
    setPageTitle(c.displayName);

    view.innerHTML = `
      ${bannerHTML(c.displayName)}
      <div class="channel-head">
        ${avatarHTML(c.displayName, 'xl')}
        <div class="channel-id">
          <h1>${esc(c.displayName)} ${c.role === 'admin' ? '<span class="badge admin">admin</span>' : ''}</h1>
          <p class="small muted">
            @${esc(c.displayName.toLowerCase().replace(/\s+/g, ''))}
            <span class="dot"></span>${formatCount(c.subscriberCount)} subscribers
            <span class="dot"></span>${formatCount(c.videoCount)} videos
            <span class="dot"></span>${formatCount(c.totalViews)} views
            <span class="dot"></span>Joined ${formatDate(c.createdAt)}
          </p>
          <p class="small muted">${videos.length ? 'Creates video content on JOSH.' : 'No videos published yet.'}</p>
        </div>
        <div class="channel-actions">
          ${
            data.isOwner
              ? `<a class="btn ghost" href="/studio">${icon('chart')}Creator Studio</a>
                 <a class="btn primary" href="/upload">${icon('upload')}Upload</a>`
              : `<button class="btn ${data.subscribed ? 'ghost subscribed' : 'primary'}" id="subscribe">
                   ${data.subscribed ? `${icon('check')}Subscribed` : 'Subscribe'}
                 </button>`
          }
        </div>
      </div>

      <div class="channel-tabs" role="tablist">
        <button class="chip active" data-tab="videos" role="tab">Videos</button>
        ${collections.length ? `<button class="chip" data-tab="collections" role="tab">Collections</button>` : ''}
        <button class="chip" data-tab="about" role="tab">About</button>
      </div>

      <section id="tab-videos" class="mt-16">
        ${videos.length ? `<div class="video-grid" id="grid"></div>` : ''}
      </section>
      <section id="tab-collections" class="mt-16 hidden"></section>
      <section id="tab-about" class="mt-16 hidden">
        <div class="panel" style="padding:20px">
          <h3 class="section-title">About this channel</h3>
          <p class="small muted">Channel on JOSH. Statistics shown here are counted from real activity on the platform.</p>
          <div class="stat-grid mt-16">
            <div class="stat"><span class="k">Subscribers</span><span class="v">${formatCount(c.subscriberCount)}</span></div>
            <div class="stat"><span class="k">Published videos</span><span class="v">${formatCount(c.videoCount)}</span></div>
            <div class="stat"><span class="k">Total views</span><span class="v">${formatCount(c.totalViews)}</span></div>
            <div class="stat"><span class="k">Joined</span><span class="v" style="font-size:16px">${formatDate(c.createdAt)}</span></div>
          </div>
        </div>
      </section>`;

    if (videos.length) {
      renderGrid(document.getElementById('grid'), videos);
    } else {
      document.getElementById('tab-videos').innerHTML = emptyState({
        icon: 'film',
        title: 'No videos yet',
        text: data.isOwner
          ? 'Upload your first video to start building this channel.'
          : 'This creator has not published a video yet.',
        action: data.isOwner ? '<a class="btn primary" href="/upload">Upload a video</a>' : '',
      });
    }

    if (collections.length) {
      document.getElementById('tab-collections').innerHTML = collections
        .map(
          (col) => `
          <div class="mt-24">
            <div class="section-title">${icon('grid')}${esc(col.name)} <span class="small muted">· ${col.videos.length}</span></div>
            <div class="video-grid dense" data-col="${esc(col.name)}"></div>
          </div>`,
        )
        .join('');
      document.querySelectorAll('[data-col]').forEach((node) => {
        const col = collections.find((x) => x.name === node.dataset.col);
        if (col) renderGrid(node, col.videos);
      });
    }

    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
        ['videos', 'collections', 'about'].forEach((name) => {
          const node = document.getElementById(`tab-${name}`);
          if (node) node.classList.toggle('hidden', name !== btn.dataset.tab);
        });
      });
    });

    const subBtn = document.getElementById('subscribe');
    if (subBtn) {
      subBtn.addEventListener('click', async () => {
        const subscribing = !subBtn.classList.contains('subscribed');
        subBtn.disabled = true;
        try {
          await api(`/api/channels/${encodeURIComponent(c.id)}/subscribe`, {
            method: subscribing ? 'POST' : 'DELETE',
          });
          const refreshed = await api(`/api/channels/${encodeURIComponent(c.id)}`);
          const count = refreshed.channel.subscriberCount;
          subBtn.className = `btn ${refreshed.subscribed ? 'ghost subscribed' : 'primary'}`;
          subBtn.innerHTML = refreshed.subscribed ? `${icon('check')}Subscribed` : 'Subscribe';
          const meta = view.querySelector('.channel-id p');
          if (meta) {
            meta.innerHTML = meta.innerHTML.replace(
              /\d[\d.,KM]* subscribers/,
              `${formatCount(count)} subscribers`,
            );
          }
          toast(refreshed.subscribed ? 'Subscribed' : 'Unsubscribed', 'ok');
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
  } catch (err) {
    view.innerHTML = emptyState({
      icon: 'user',
      title: err.status === 404 ? 'Channel not found' : 'Could not load this channel',
      text: err.status === 404 ? 'This channel does not exist.' : err.message,
      action: '<a class="btn ghost" href="/">Back to home</a>',
    });
  }
}

(async function init() {
  me = await mountShell({ active: '' });
  load();
})();
