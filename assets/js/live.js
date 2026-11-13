/**
 * JOSH — live streaming preparation.
 * Sessions are real records; broadcasting stays disabled until a provider is
 * configured, and the page states that plainly rather than faking a stream.
 */
import {
  mountShell,
  api,
  esc,
  icon,
  toast,
  setPageTitle,
  timeAgo,
  emptyState,
  getSession,
  confirmDialog,
} from './core.js';

const view = document.getElementById('view');
let cameraStream = null;

function statusPill(status) {
  const map = { live: 'ok', scheduled: 'warn', ended: 'info' };
  return `<span class="pill ${map[status] || 'info'}">${esc(status)}</span>`;
}

async function load() {
  setPageTitle('Live');
  const me = await getSession();
  view.innerHTML = `<div class="page-head"><h1>Live</h1></div><div class="skeleton-block"></div>`;

  let config = { configured: false, note: '' };
  let sessions = [];
  try {
    const [c, s] = await Promise.all([api('/api/live/config'), api('/api/live/sessions')]);
    config = c || config;
    sessions = (s && s.sessions) || [];
  } catch (err) {
    view.innerHTML = `<div class="page-head"><h1>Live</h1></div>`;
    view.appendChild(emptyState({ icon: 'alert', title: 'Could not load live status', text: err.message }));
    return;
  }

  view.innerHTML = `<div class="page-head">
      <div>
        <h1>Live streaming</h1>
        <p class="sub">Sessions, go-live workflow and camera preview. Broadcasting turns on when a provider is connected.</p>
      </div>
    </div>

    ${
      config.configured
        ? `<div class="alert info"><strong>Provider connected.</strong><span>Ingest and playback are configured for this deployment.</span></div>`
        : `<div class="alert info">
            <strong>Broadcasting is not active.</strong>
            <span>${esc(config.note || 'No livestream provider is configured yet.')}</span>
            <span class="small muted">To enable it, set <code class="mono">LIVE_PROVIDER</code>, <code class="mono">LIVE_INGEST_URL</code> and <code class="mono">LIVE_PLAYBACK_URL_TEMPLATE</code> in Settings → Environment variables.</span>
          </div>`
    }

    <div class="split-grid">
      <section class="card pad">
        <div class="card-head"><h2>Camera preview</h2><span class="pill ${config.configured ? 'ok' : 'warn'}">${config.configured ? 'ready' : 'setup required'}</span></div>
        <div class="live-stage" id="stage">
          <video id="preview" playsinline muted autoplay class="hidden"></video>
          <div class="player-empty" id="stage-empty">
            ${icon('camera', 28)}
            <p>Check your camera and microphone before a stream.</p>
          </div>
        </div>
        <div class="row gap-12 mt-16">
          <button class="btn ghost" id="preview-start">${icon('camera', 16)} Start preview</button>
          <button class="btn ghost hidden" id="preview-stop">Stop preview</button>
        </div>
      </section>

      <section class="card pad">
        <div class="card-head"><h2>Schedule a stream</h2></div>
        ${
          me
            ? `<form id="live-form" class="form-grid" novalidate>
                <div class="field">
                  <label for="title">Stream title</label>
                  <input class="input" id="title" name="title" maxlength="120" placeholder="What are you streaming?" required>
                </div>
                <button class="btn primary" type="submit">${icon('broadcast', 16)} Create session</button>
                <p class="hint">A session record is created immediately. It can only go live once a provider is configured.</p>
              </form>`
            : `<p class="muted">Sign in to schedule a stream.</p><a class="btn primary mt-16" href="/login?next=/live">Sign in</a>`
        }
      </section>
    </div>

    <section class="card">
      <div class="card-head pad-x"><h2>Stream sessions</h2><span class="muted small">${sessions.length} total</span></div>
      ${
        sessions.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Title</th><th>Creator</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>${sessions
                .map(
                  (s) => `<tr>
                    <td>${esc(s.title)}</td>
                    <td>${esc(s.owner)}</td>
                    <td>${statusPill(s.status)}</td>
                    <td>${esc(timeAgo(s.createdAt))}</td>
                    <td class="cell-actions">
                      ${
                        s.mine && s.status === 'scheduled'
                          ? `<button class="btn sm ghost" data-end="${esc(s.id)}">End session</button>`
                          : ''
                      }
                    </td>
                  </tr>`
                )
                .join('')}</tbody>
            </table></div>`
          : emptyState({
              icon: 'broadcast',
              title: 'No stream sessions yet',
              text: 'Scheduled sessions appear here with their real status.',
            })
      }
    </section>`;

  document.getElementById('preview-start')?.addEventListener('click', async () => {
    const video = document.getElementById('preview');
    const empty = document.getElementById('stage-empty');
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      video.srcObject = cameraStream;
      video.classList.remove('hidden');
      empty?.classList.add('hidden');
      document.getElementById('preview-stop')?.classList.remove('hidden');
    } catch {
      toast('Camera or microphone permission was denied', 'error');
    }
  });

  document.getElementById('preview-stop')?.addEventListener('click', () => {
    stopPreview();
  });

  document.getElementById('live-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('title');
    try {
      await api('/api/live/sessions', { method: 'POST', body: { title: input.value.trim() } });
      toast('Session created');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  view.addEventListener('click', async (e) => {
    const endId = e.target.closest('[data-end]')?.dataset.end;
    if (!endId) return;
    const ok = await confirmDialog({
      title: 'End this session?',
      text: 'The session will be marked as ended.',
      confirmText: 'End session',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/live/sessions/${endId}`, { method: 'PATCH', body: { status: 'ended' } });
      toast('Session ended');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function stopPreview() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('preview');
  if (video) {
    video.srcObject = null;
    video.classList.add('hidden');
  }
  document.getElementById('stage-empty')?.classList.remove('hidden');
  document.getElementById('preview-stop')?.classList.add('hidden');
}

mountShell({ view: 'live' });
load();
window.addEventListener('beforeunload', stopPreview);
