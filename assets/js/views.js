import {
  api,
  state,
  initPage,
  requireUser,
  compact,
  timeAgo,
  escapeHtml,
  el,
  statusPill,
  notice,
  initials,
} from './api.js';

export function formatDuration(sec) {
  const total = Number(sec) || 0;
  if (!total) return '';
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function videoCard(v) {
  const thumb = v.hasThumbnail
    ? `<img src="/api/videos/${v.id}/thumbnail" alt="" loading="lazy">`
    : '<span>JOSH</span>';
  return `
    <a class="video-card" href="/watch?v=${encodeURIComponent(v.id)}">
      <div class="thumb">${thumb}</div>
      <div class="video-body">
        <h3>${escapeHtml(v.title)}</h3>
        <div class="video-meta">
          <span>${escapeHtml(v.creator.displayName)}</span>
          <span>${compact(v.views)} views</span>
          <span>${timeAgo(v.publishedAt || v.createdAt)}</span>
        </div>
      </div>
    </a>`;
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* -------------------------------------------------------------------- feed */

export async function feed() {
  await initPage();
  const grid = el('feed-grid');
  const search = el('feed-search');
  const stats = el('feed-stats');

  async function load() {
    const q = search ? search.value.trim() : '';
    grid.setAttribute('aria-busy', 'true');
    try {
      const [{ videos }, publicStats] = await Promise.all([
        api(`/api/videos${q ? `?q=${encodeURIComponent(q)}` : ''}`),
        api('/api/stats/public'),
      ]);

      if (stats) {
        stats.innerHTML = `
          <div class="stat"><strong>${compact(publicStats.videos)}</strong><span>Videos published</span></div>
          <div class="stat"><strong>${compact(publicStats.creators)}</strong><span>Creators</span></div>
          <div class="stat"><strong>${compact(publicStats.views)}</strong><span>Total views</span></div>
          <div class="stat"><strong>${compact(publicStats.likes)}</strong><span>Likes</span></div>`;
      }

      if (!videos.length) {
        grid.innerHTML = `
          <div class="empty" style="grid-column: 1 / -1;">
            <strong>${q ? 'No videos match that search' : 'No videos published yet'}</strong>
            ${
              q
                ? 'Try a different word.'
                : state.user
                  ? '<a class="button primary" href="/upload" style="margin-top:14px;">Upload the first video</a>'
                  : '<a class="button primary" href="/signup" style="margin-top:14px;">Create an account to upload</a>'
            }
          </div>`;
        return;
      }

      grid.innerHTML = videos.map(videoCard).join('');
    } catch (error) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1;"><strong>Could not load the feed</strong>${escapeHtml(error.message)}</div>`;
    } finally {
      grid.removeAttribute('aria-busy');
    }
  }

  if (search) search.addEventListener('input', debounce(load, 250));
  await load();
}

/* ------------------------------------------------------------------- watch */

export async function watch() {
  await initPage();
  const shell = el('watch-root');
  const id = new URLSearchParams(window.location.search).get('v');

  if (!id) {
    shell.innerHTML = '<div class="empty"><strong>No video selected</strong><a class="button primary" href="/feed" style="margin-top:14px;">Browse the feed</a></div>';
    return;
  }

  let data;
  try {
    data = await api(`/api/videos/${encodeURIComponent(id)}`);
  } catch (error) {
    shell.innerHTML = `<div class="empty"><strong>Video unavailable</strong>${escapeHtml(error.message)}<div style="margin-top:14px;"><a class="button primary" href="/feed">Back to feed</a></div></div>`;
    return;
  }

  const v = data.video;
  document.title = `${v.title} | JOSH`;
  const poster = v.hasThumbnail ? `/api/videos/${v.id}/thumbnail` : '';

  shell.innerHTML = `
    <div class="watch-layout">
      <div>
        <div class="player-shell">
          <video id="player" controls playsinline preload="metadata" ${poster ? `poster="${poster}"` : ''} src="${data.streamUrl}"></video>
        </div>

        <div class="panel" style="margin-top:20px;">
          <div class="spread" style="align-items:flex-start;">
            <div>
              <h1 style="font-size:22px;margin:0 0 8px;">${escapeHtml(v.title)}</h1>
              <div class="video-meta">
                <span>${escapeHtml(v.creator.displayName)}</span>
                <span>${timeAgo(v.publishedAt || v.createdAt)}</span>
                <span id="view-count">${compact(v.views)} views</span>
                ${v.status !== 'published' ? statusPill(v.status) : ''}
              </div>
            </div>
            <div class="row">
              ${data.owner && v.status === 'draft' ? '<button class="button primary small" id="publish-btn" type="button">Publish</button>' : ''}
              <button class="button secondary small" id="like-btn" type="button" aria-pressed="${data.liked}">
                ${data.liked ? 'Liked' : 'Like'} · <span id="like-count">${v.likes}</span>
              </button>
            </div>
          </div>
          ${v.description ? `<p class="muted" style="margin:16px 0 0;font-size:14px;line-height:1.6;">${escapeHtml(v.description)}</p>` : ''}
          ${v.status === 'draft' ? '<div class="notice warn" style="margin:16px 0 0;">This video is a draft and only visible to you and administrators.</div>' : ''}
        </div>
      </div>

      <aside class="panel">
        <h2>Comments</h2>
        <p class="hint">${v.comments === 0 ? 'No comments yet.' : `${v.comments} in total`}</p>
        <div id="comment-list"></div>
        ${
          state.user
            ? `<form id="comment-form" style="margin-top:16px;">
                 <div class="field">
                   <label for="comment-body">Add a comment</label>
                   <textarea id="comment-body" maxlength="1000" required placeholder="Share what you think…"></textarea>
                 </div>
                 <button class="button primary small" type="submit">Post comment</button>
               </form>`
            : '<div class="notice" style="margin:0;">Sign in to join the conversation.</div>'
        }
      </aside>
    </div>`;

  const renderComments = (list) => {
    const node = el('comment-list');
    if (!node) return;
    if (!list.length) {
      node.innerHTML = '<p class="small muted">No comments yet.</p>';
      return;
    }
    node.innerHTML = list
      .slice()
      .reverse()
      .map(
        (c) => `
        <div class="comment">
          <div class="avatar">${escapeHtml(initials(c.author))}</div>
          <div class="comment-body">
            <strong>${escapeHtml(c.author)}</strong>
            ${escapeHtml(c.body)}
            <div class="small muted" style="margin-top:4px;">${timeAgo(c.createdAt)}</div>
          </div>
        </div>`,
      )
      .join('');
  };
  renderComments(data.comments);

  // Count a view once playback actually starts, not when the page loads.
  const player = el('player');
  let counted = false;
  player.addEventListener(
    'play',
    async () => {
      if (counted) return;
      counted = true;
      try {
        const result = await api(`/api/videos/${v.id}/view`, { method: 'POST' });
        const node = el('view-count');
        if (node) node.textContent = `${compact(result.views)} views`;
      } catch {
        /* view counting is best effort */
      }
    },
    { once: false },
  );

  const likeBtn = el('like-btn');
  if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
      if (!state.user) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const liked = likeBtn.getAttribute('aria-pressed') === 'true';
      try {
        const result = await api(`/api/videos/${v.id}/like`, { method: liked ? 'DELETE' : 'POST' });
        likeBtn.setAttribute('aria-pressed', String(result.liked));
        likeBtn.innerHTML = `${result.liked ? 'Liked' : 'Like'} · <span id="like-count">${result.likes}</span>`;
      } catch (error) {
        notice('watch-error', escapeHtml(error.message), 'error');
      }
    });
  }

  const publishBtn = el('publish-btn');
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      try {
        await api(`/api/videos/${v.id}/publish`, { method: 'POST' });
        window.location.reload();
      } catch (error) {
        notice('watch-error', escapeHtml(error.message), 'error');
      }
    });
  }

  const commentForm = el('comment-form');
  if (commentForm) {
    commentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = el('comment-body').value.trim();
      if (!body) return;
      try {
        await api(`/api/videos/${v.id}/comments`, { method: 'POST', body: { body } });
        const refreshed = await api(`/api/videos/${encodeURIComponent(v.id)}`);
        renderComments(refreshed.comments);
        el('comment-body').value = '';
      } catch (error) {
        notice('watch-error', escapeHtml(error.message), 'error');
      }
    });
  }
}

/* ------------------------------------------------------------------ upload */

function uploadWithProgress(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText || '{}'));
        } catch {
          resolve({});
        }
        return;
      }
      let message = `Upload failed (${xhr.status})`;
      try {
        message = JSON.parse(xhr.responseText).error || message;
      } catch {
        /* keep default */
      }
      reject(new Error(message));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed — check your connection and try again.')));
    xhr.send(file);
  });
}

async function captureThumbnail(file) {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  video.src = url;

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out reading the video file.')), 15000);
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        resolve();
      });
      video.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('That file could not be read as a video. Try MP4 or WebM.'));
      });
    });

    const duration = video.duration;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      video.addEventListener('seeked', () => {
        clearTimeout(timer);
        resolve();
      });
      video.currentTime = Math.min(Math.max(duration / 3, 0.1), 5);
    });

    const width = 640;
    const ratio = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width * ratio) || 360;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.8),
      durationSec: Math.round(duration) || 0,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function upload() {
  const user = await requireUser();
  if (!user) return;

  const form = el('upload-form');
  const statusBox = el('upload-status');
  const progressBar = el('upload-progress');
  const progressFill = el('upload-progress-fill');
  const submit = el('upload-submit');
  const preview = el('thumb-preview');

  let limits = { maxUploadMb: 128 };
  try {
    const status = await api('/api/status');
    limits = status.limits;
    const limitNote = el('upload-limit');
    if (limitNote) limitNote.textContent = `Maximum file size: ${limits.maxUploadMb} MB.`;
  } catch {
    /* keep defaults */
  }

  const fileInput = el('video-file');
  if (fileInput && preview) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      preview.innerHTML = '';
      if (!file) return;
      if (file.size > limits.maxUploadMb * 1024 * 1024) {
        notice(statusBox, `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${limits.maxUploadMb} MB.`, 'error');
        fileInput.value = '';
        return;
      }
      try {
        const thumb = await captureThumbnail(file);
        const img = document.createElement('img');
        img.src = thumb.dataUrl;
        img.alt = 'Video thumbnail preview';
        img.style.cssText = 'width:100%;border-radius:12px;display:block;';
        preview.appendChild(img);
        const meta = document.createElement('p');
        meta.className = 'small muted';
        meta.textContent = `Duration ${formatDuration(thumb.durationSec)} · ${(file.size / 1048576).toFixed(1)} MB`;
        preview.appendChild(meta);
        preview.dataset.dataUrl = thumb.dataUrl;
        preview.dataset.duration = String(thumb.durationSec);
        statusBox.hidden = true;
      } catch (error) {
        notice(statusBox, escapeHtml(error.message), 'error');
      }
    });
  }

  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      notice(statusBox, 'Choose a video file first.', 'error');
      return;
    }
    const title = el('video-title').value.trim();
    const description = el('video-description').value.trim();

    submit.disabled = true;
    submit.textContent = 'Uploading…';
    progressBar.hidden = false;
    progressFill.style.width = '2%';
    notice(statusBox, 'Creating the video record…');

    try {
      const created = await api('/api/videos', {
        method: 'POST',
        body: { title, description, durationSec: Number(preview.dataset.duration) || null },
      });
      const videoId = created.video.id;

      notice(statusBox, 'Uploading the video file…');
      await uploadWithProgress(created.upload.url, file, (ratio) => {
        progressFill.style.width = `${Math.max(2, Math.round(ratio * 88))}%`;
      });

      if (preview.dataset.dataUrl) {
        notice(statusBox, 'Saving the thumbnail…');
        await api(`/api/videos/${videoId}/thumbnail`, {
          method: 'POST',
          body: { dataUrl: preview.dataset.dataUrl },
        });
      }

      progressFill.style.width = '96%';
      notice(statusBox, 'Publishing…');
      await api(`/api/videos/${videoId}/publish`, { method: 'POST' });
      progressFill.style.width = '100%';
      notice(statusBox, 'Published. Opening your video…', 'ok');
      window.location.href = `/watch?v=${encodeURIComponent(videoId)}`;
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Upload video';
      progressBar.hidden = true;
      notice(statusBox, escapeHtml(error.message), 'error');
    }
  });
}

/* ------------------------------------------------------------- auth pages */

export async function login() {
  await initPage();
  if (state.user) {
    window.location.href = '/feed';
    return;
  }
  const form = el('login-form');
  const box = el('login-status');
  const next = new URLSearchParams(window.location.search).get('next') || '/feed';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: { email: el('email').value.trim(), password: el('password').value },
      });
      window.location.href = next.startsWith('/') ? next : '/feed';
    } catch (error) {
      notice(box, escapeHtml(error.message), 'error');
      button.disabled = false;
    }
  });
}

export async function signup() {
  await initPage();
  if (state.user) {
    window.location.href = '/feed';
    return;
  }
  const form = el('signup-form');
  const box = el('signup-status');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/auth/signup', {
        method: 'POST',
        body: {
          displayName: el('display-name').value.trim(),
          email: el('email').value.trim(),
          password: el('password').value,
        },
      });
      if (result.notice) {
        notice(box, escapeHtml(result.notice), 'ok');
        setTimeout(() => {
          window.location.href = '/feed';
        }, 1600);
        return;
      }
      window.location.href = '/feed';
    } catch (error) {
      notice(box, escapeHtml(error.message), 'error');
      button.disabled = false;
    }
  });
}
