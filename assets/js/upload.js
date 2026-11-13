/**
 * JOSH — upload flow: metadata, file, auto-generated thumbnail, progress and
 * publish. Uses the existing endpoints (create draft, PUT file, POST thumbnail,
 * POST publish) so uploads keep working exactly as before.
 */
import {
  mountShell,
  api,
  uploadFile,
  esc,
  icon,
  toast,
  setPageTitle,
  emptyState,
} from './core.js';

const view = document.getElementById('view');
const MAX_BYTES = 200 * 1024 * 1024;

let categories = ['Other'];
let file = null;
let thumbDataUrl = null;
let durationSec = 0;
let createdVideoId = null;

view.innerHTML = `<div class="skeleton card" style="height:60vh"></div>`;

function bytes(n) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shell() {
  return `
    <div class="page-head">
      <div>
        <h1>Upload a video</h1>
        <p>Publish to JOSH. You can save a draft and publish later.</p>
      </div>
      <a class="btn ghost sm" href="/studio">${icon('chart')}Creator Studio</a>
    </div>

    <form id="upload-form" class="upload-grid" novalidate>
      <div class="stack">
        <div class="drop-zone" id="drop">
          <span class="dz-icon">${icon('upload')}</span>
          <strong id="drop-title">Drag and drop your video</strong>
          <span class="small muted" id="drop-sub">MP4, WebM or MOV · up to 200 MB</span>
          <input type="file" id="file" accept="video/mp4,video/webm,video/quicktime" hidden>
          <button class="btn ghost sm mt-12" type="button" id="browse">Choose file</button>
        </div>

        <div class="field">
          <label for="title">Title <span class="muted">(required)</span></label>
          <input class="input" id="title" name="title" maxlength="120" required placeholder="Give your video a clear title">
        </div>

        <div class="field">
          <label for="description">Description</label>
          <textarea class="textarea" id="description" name="description" rows="4" maxlength="2000" placeholder="Tell viewers what your video is about"></textarea>
        </div>

        <div class="form-row">
          <div class="field">
            <label for="category">Category</label>
            <select class="select" id="category" name="category"></select>
          </div>
          <div class="field">
            <label>Visibility</label>
            <div class="checkline">
              <input type="checkbox" id="publish-now" checked>
              <label for="publish-now" style="margin:0">Publish immediately</label>
            </div>
            <p class="hint">Unchecked saves a private draft you can publish from Creator Studio.</p>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="panel" style="padding:16px">
          <h3 class="section-title">${icon('camera')}Thumbnail</h3>
          <div class="thumb-preview" id="thumb-preview">
            <span class="small muted">A frame is captured from your video automatically.</span>
          </div>
          <input type="file" id="thumb-file" accept="image/png,image/jpeg,image/webp" hidden>
          <button class="btn ghost sm mt-12" type="button" id="thumb-pick">Use a custom image</button>
        </div>

        <div class="panel" style="padding:16px">
          <h3 class="section-title">${icon('info')}Details</h3>
          <ul class="points small muted" id="facts">
            <li>No file selected yet.</li>
          </ul>
        </div>

        <div class="progress hidden" id="progress-wrap"><div class="progress" id="progress"><span style="width:0%"></span></div></div>
        <p class="small muted" id="status"></p>

        <div class="row gap-8">
          <button class="btn primary" type="submit" id="submit">${icon('upload')}Upload</button>
          <a class="btn ghost" href="/studio">Cancel</a>
        </div>
      </div>
    </form>`;
}

function renderFacts() {
  const facts = document.getElementById('facts');
  if (!facts) return;
  const rows = [];
  if (file) {
    rows.push(`<li><strong>${esc(file.name)}</strong> · ${bytes(file.size)}</li>`);
    rows.push(`<li>Type: ${esc(file.type || 'unknown')}</li>`);
  } else {
    rows.push('<li>No file selected yet.</li>');
  }
  if (durationSec) {
    rows.push(`<li>Duration: ${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, '0')}${durationSec <= 60 ? ' · eligible for Shorts' : ''}</li>`);
  }
  if (thumbDataUrl) rows.push('<li>Thumbnail ready</li>');
  facts.innerHTML = rows.join('');
}

async function grabFrame(f) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(f);
    video.src = url;

    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    video.addEventListener('loadedmetadata', () => {
      durationSec = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      video.currentTime = Math.min(Math.max(0.2, video.duration * 0.1), 2);
    });
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.82));
      } catch {
        done(null);
      }
    });
    video.addEventListener('error', () => done(null));
    setTimeout(() => done(null), 8000);
  });
}

function setProgress(pct, label) {
  const wrap = document.getElementById('progress-wrap');
  const bar = document.getElementById('progress');
  if (!wrap || !bar) return;
  wrap.classList.remove('hidden');
  bar.querySelector('span').style.width = `${pct}%`;
  const status = document.getElementById('status');
  if (status && label) status.textContent = label;
}

async function onSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  const category = document.getElementById('category').value;
  const publishNow = document.getElementById('publish-now').checked;
  const submit = document.getElementById('submit');

  if (!file) {
    toast('Choose a video file first', 'error');
    return;
  }
  if (!title) {
    toast('Add a title for your video', 'error');
    document.getElementById('title').focus();
    return;
  }
  if (file.size > MAX_BYTES) {
    toast(`That file is ${bytes(file.size)} — the limit is 200 MB`, 'error');
    return;
  }

  submit.disabled = true;
  try {
    if (!createdVideoId) {
      setProgress(4, 'Creating video record…');
      const created = await api('/api/videos', {
        method: 'POST',
        body: { title, description, category, durationSec },
      });
      createdVideoId = (created.video && created.video.id) || created.id;
      if (!createdVideoId) throw new Error('The server did not return a video id.');
    }

    setProgress(10, 'Uploading video…');
    await uploadFile(`/api/videos/${encodeURIComponent(createdVideoId)}/file`, file, (pct) => {
      setProgress(10 + Math.round(pct * 0.75), `Uploading video… ${pct}%`);
    });

    if (thumbDataUrl) {
      setProgress(88, 'Saving thumbnail…');
      await api(`/api/videos/${encodeURIComponent(createdVideoId)}/thumbnail`, {
        method: 'POST',
        body: { dataUrl: thumbDataUrl },
      });
    }

    if (publishNow) {
      setProgress(94, 'Publishing…');
      await api(`/api/videos/${encodeURIComponent(createdVideoId)}/publish`, { method: 'POST' });
    }

    setProgress(100, publishNow ? 'Published!' : 'Saved as draft');
    toast(publishNow ? 'Video published' : 'Draft saved', 'ok');
    location.href = publishNow
      ? `/watch?v=${encodeURIComponent(createdVideoId)}`
      : '/studio';
  } catch (err) {
    submit.disabled = false;
    setProgress(0, '');
    document.getElementById('progress-wrap').classList.add('hidden');
    toast(err.message, 'error');
  }
}

async function init() {
  const user = await mountShell({ active: 'upload' });
  if (!user) {
    view.innerHTML = emptyState({
      icon: 'upload',
      title: 'Sign in to upload',
      text: 'You need a JOSH account to upload videos and track your stats.',
      action: `<a class="btn primary" href="/login?next=${encodeURIComponent('/upload')}">Sign in</a>
               <a class="btn ghost" href="/signup">Create account</a>`,
    });
    return;
  }

  try {
    const data = await api('/api/categories');
    if (Array.isArray(data.categories) && data.categories.length) categories = data.categories;
  } catch {
    /* keep Other */
  }

  view.innerHTML = shell();
  const select = document.getElementById('category');
  select.innerHTML = categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  const drop = document.getElementById('drop');
  const input = document.getElementById('file');
  const thumbInput = document.getElementById('thumb-file');
  const preview = document.getElementById('thumb-preview');

  const accept = async (f) => {
    if (!f) return;
    if (!/^video\//.test(f.type || '')) {
      toast('Choose a video file (MP4, WebM or MOV)', 'error');
      return;
    }
    file = f;
    document.getElementById('drop-title').textContent = f.name;
    document.getElementById('drop-sub').textContent = `${bytes(f.size)} · ready to upload`;
    if (!document.getElementById('title').value.trim()) {
      document.getElementById('title').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120);
    }
    renderFacts();
    const frame = await grabFrame(f);
    if (frame && !thumbDataUrl) {
      thumbDataUrl = frame;
      preview.innerHTML = `<img src="${frame}" alt="Thumbnail preview">`;
      renderFacts();
    }
  };

  document.getElementById('browse').addEventListener('click', () => input.click());
  input.addEventListener('change', () => accept(input.files && input.files[0]));
  drop.addEventListener('click', (e) => {
    if (e.target === drop) input.click();
  });
  ['dragenter', 'dragover'].forEach((evt) =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.add('drag');
    }),
  );
  ['dragleave', 'drop'].forEach((evt) =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
    }),
  );
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    accept(f);
  });

  document.getElementById('thumb-pick').addEventListener('click', () => thumbInput.click());
  thumbInput.addEventListener('change', () => {
    const f = thumbInput.files && thumbInput.files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) {
      toast('Thumbnail must be under 1 MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      thumbDataUrl = String(reader.result);
      preview.innerHTML = `<img src="${thumbDataUrl}" alt="Thumbnail preview">`;
      renderFacts();
    };
    reader.readAsDataURL(f);
  });

  document.getElementById('upload-form').addEventListener('submit', onSubmit);
  renderFacts();
}

init();
