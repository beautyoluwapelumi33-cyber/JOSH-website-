import {
  api,
  state,
  requireUser,
  compact,
  timeAgo,
  escapeHtml,
  el,
  statusPill,
  notice,
} from './api.js';

/* ------------------------------------------------------------------- admin */

export async function admin() {
  const user = await requireUser();
  if (!user) return;

  const root = el('admin-root');
  if (user.role !== 'admin') {
    root.innerHTML = `
      <div class="empty">
        <strong>Administrators only</strong>
        This area is restricted to accounts with the administrator role. Access is refused by the server, not just hidden here.
        <div style="margin-top:14px;"><a class="button primary" href="/feed">Back to the feed</a></div>
      </div>`;
    return;
  }

  let overview;
  let users = [];
  let withdrawals = [];
  let videos = [];
  try {
    [overview, { users }, { withdrawals }, { videos }] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/users'),
      api('/api/admin/withdrawals'),
      api('/api/admin/videos'),
    ]);
  } catch (error) {
    root.innerHTML = `<div class="empty"><strong>Could not load the admin dashboard</strong>${escapeHtml(error.message)}</div>`;
    return;
  }

  const { counts, revenue, payments } = overview;
  const pending = withdrawals.filter((w) => w.status === 'pending');

  root.innerHTML = `
    <div class="notice warn">
      <strong>${payments.active ? 'Payment provider connected.' : 'No payment provider is connected.'}</strong>
      ${escapeHtml(payments.note)} Every figure on this page is a recorded fact, never an estimate.
    </div>

    <div class="stats" style="margin-bottom:24px;">
      <div class="stat"><strong>${compact(counts.users)}</strong><span>Accounts</span></div>
      <div class="stat"><strong>${compact(counts.creators)}</strong><span>Creators</span></div>
      <div class="stat"><strong>${compact(counts.published)}</strong><span>Published videos</span></div>
      <div class="stat"><strong>${compact(counts.views)}</strong><span>Views</span></div>
      <div class="stat"><strong>${escapeHtml(revenue.grossUsdt)}</strong><span>Gross USDT recorded</span></div>
      <div class="stat"><strong>${escapeHtml(revenue.platformUsdt)}</strong><span>Platform 40%</span></div>
    </div>

    <div class="grid cols-2" style="margin-bottom:24px;">
      <div class="panel">
        <h2>Withdrawals awaiting action</h2>
        <p class="hint">${pending.length} pending · ${escapeHtml(overview.withdrawals.pendingUsdt)} USDT requested</p>
        ${
          pending.length
            ? `<div class="table-wrap">
                <table>
                  <thead><tr><th>Creator</th><th>Amount</th><th>Address</th><th>Requested</th></tr></thead>
                  <tbody>
                    ${pending
                      .map(
                        (w) => `<tr>
                          <td>${escapeHtml(w.user ? w.user.displayName : 'Unknown')}<div class="small muted">${escapeHtml(w.user ? w.user.email : '')}</div></td>
                          <td class="amount">${escapeHtml(w.amountUsdt)}</td>
                          <td class="mono small">${escapeHtml(w.address)}</td>
                          <td class="nowrap muted small">${timeAgo(w.createdAt)}</td>
                        </tr>`,
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
            : '<div class="empty"><strong>Nothing pending</strong>No withdrawal requests are waiting for review.</div>'
        }
      </div>

      <div class="panel">
        <h2>Record a real payment</h2>
        <p class="hint">
          Only use this after money has genuinely arrived from a sponsor, ad network or viewer.
          It splits 60/40 and credits the creator's balance. It does not charge anyone.
        </p>
        <div id="revenue-status" hidden></div>
        <form id="revenue-form">
          <div class="field">
            <label for="revenue-creator">Creator</label>
            <select id="revenue-creator" required>
              <option value="">Select a creator…</option>
              ${users
                .map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.displayName)} — ${escapeHtml(u.email)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="field">
              <label for="revenue-amount">Gross amount (USDT)</label>
              <input id="revenue-amount" type="text" inputmode="decimal" placeholder="0.00" required />
            </div>
            <div class="field">
              <label for="revenue-source">Source</label>
              <input id="revenue-source" type="text" maxlength="60" placeholder="Sponsorship, ad payout…" required />
            </div>
          </div>
          <div class="field">
            <label for="revenue-note">Reference (optional)</label>
            <input id="revenue-note" type="text" maxlength="500" placeholder="Invoice or transaction reference" />
          </div>
          <button class="button primary" type="submit">Record payment</button>
        </form>
      </div>
    </div>

    <div class="panel" style="margin-bottom:24px;">
      <h2>Accounts and roles</h2>
      <p class="hint">Roles decide what the server allows. Changing a role takes effect on that account's next request.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Account</th><th>Role</th><th>Videos</th><th>Views</th><th>Earned</th><th>Available</th><th>Joined</th></tr></thead>
          <tbody>
            ${users
              .map(
                (u) => `<tr>
                  <td><strong>${escapeHtml(u.displayName)}</strong><div class="small muted">${escapeHtml(u.email)}</div></td>
                  <td>
                    <select data-role-for="${escapeHtml(u.id)}" ${u.id === user.id ? 'disabled title="You cannot change your own role"' : ''}>
                      ${['viewer', 'creator', 'admin']
                        .map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`)
                        .join('')}
                    </select>
                  </td>
                  <td class="amount">${compact(u.videos)}</td>
                  <td class="amount">${compact(u.views)}</td>
                  <td class="amount">${escapeHtml(u.earningsUsdt)}</td>
                  <td class="amount">${escapeHtml(u.availableUsdt)}</td>
                  <td class="nowrap muted small">${timeAgo(u.createdAt)}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel" style="margin-bottom:24px;">
      <h2>Withdrawal queue</h2>
      <p class="hint">
        Approving only changes the status. Marking a request paid requires the real on-chain transaction hash —
        nothing is ever marked paid automatically, and no transfer is sent from this dashboard.
      </p>
      <div id="admin-wd-status" hidden></div>
      ${
        withdrawals.length
          ? `<div class="table-wrap">
              <table>
                <thead><tr><th>Creator</th><th>Amount</th><th>Address</th><th>Status</th><th>Settlement</th></tr></thead>
                <tbody>
                  ${withdrawals
                    .map(
                      (w) => `<tr>
                        <td>${escapeHtml(w.user ? w.user.displayName : 'Unknown')}<div class="small muted">${escapeHtml(w.user ? w.user.email : '')}</div></td>
                        <td class="amount">${escapeHtml(w.amountUsdt)}</td>
                        <td class="mono small">${escapeHtml(w.address)}</td>
                        <td>${statusPill(w.status)}${w.txHash ? `<div class="small mono muted">${escapeHtml(w.txHash.slice(0, 14))}…</div>` : ''}</td>
                        <td>
                          ${
                            w.status === 'paid' || w.status === 'rejected'
                              ? '<span class="small muted">closed</span>'
                              : `<div class="row" style="gap:8px;flex-wrap:wrap;">
                                   ${w.status === 'pending' ? `<button class="button secondary small" data-wd="approve" data-id="${w.id}" type="button">Approve</button>` : ''}
                                   <input data-tx="${w.id}" type="text" placeholder="0x… tx hash" style="min-width:170px;" />
                                   <button class="button primary small" data-wd="paid" data-id="${w.id}" type="button">Mark paid</button>
                                   <button class="button danger small" data-wd="reject" data-id="${w.id}" type="button">Reject</button>
                                 </div>`
                          }
                        </td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="empty"><strong>No withdrawal requests</strong>Requests will appear here for review.</div>'
      }
    </div>

    <div class="panel">
      <h2>All videos</h2>
      <p class="hint">${compact(counts.videos)} total · ${compact(counts.published)} published</p>
      ${
        videos.length
          ? `<div class="table-wrap">
              <table>
                <thead><tr><th>Title</th><th>Creator</th><th>Status</th><th>Views</th><th>Uploaded</th></tr></thead>
                <tbody>
                  ${videos
                    .map(
                      (v) => `<tr>
                        <td><a href="/watch?v=${v.id}">${escapeHtml(v.title)}</a></td>
                        <td>${escapeHtml(v.creator.displayName)}</td>
                        <td>${statusPill(v.status)}</td>
                        <td class="amount">${compact(v.views)}</td>
                        <td class="nowrap muted small">${timeAgo(v.createdAt)}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="empty"><strong>No videos yet</strong>Uploads across the platform will be listed here.</div>'
      }
    </div>`;

  // Role changes
  root.querySelectorAll('select[data-role-for]').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.dataset.roleFor;
      const role = select.value;
      select.disabled = true;
      try {
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { role } });
        notice('admin-wd-status', `Role updated to <strong>${escapeHtml(role)}</strong>.`, 'ok');
      } catch (error) {
        notice('admin-wd-status', escapeHtml(error.message), 'error');
        select.disabled = false;
      }
    });
  });

  // Withdrawal actions
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-wd]');
    if (!button) return;
    const { wd: action, id } = button.dataset;
    const txInput = root.querySelector(`input[data-tx="${id}"]`);
    const body = { action };
    if (action === 'paid') {
      body.txHash = txInput ? txInput.value.trim() : '';
      if (!body.txHash) {
        notice('admin-wd-status', 'Enter the BEP20 transaction hash before marking a request paid.', 'error');
        return;
      }
    }
    if (action === 'reject' && !window.confirm('Reject this withdrawal request? The creator keeps their balance.')) return;

    button.disabled = true;
    try {
      await api(`/api/admin/withdrawals/${id}`, { method: 'PATCH', body });
      window.location.reload();
    } catch (error) {
      notice('admin-wd-status', escapeHtml(error.message), 'error');
      button.disabled = false;
    }
  });

  // Revenue recording
  const revenueForm = el('revenue-form');
  if (revenueForm) {
    revenueForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = revenueForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const result = await api('/api/admin/revenue', {
          method: 'POST',
          body: {
            creatorId: el('revenue-creator').value,
            amount: el('revenue-amount').value.trim(),
            source: el('revenue-source').value.trim(),
            note: el('revenue-note').value.trim(),
          },
        });
        notice(
          'revenue-status',
          `Recorded ${escapeHtml(result.revenue.grossUsdt)} USDT — creator ${escapeHtml(result.revenue.creatorUsdt)}, platform ${escapeHtml(result.revenue.platformUsdt)}. ${escapeHtml(result.note)}`,
          'ok',
        );
        revenueForm.reset();
        setTimeout(() => window.location.reload(), 1800);
      } catch (error) {
        notice('revenue-status', escapeHtml(error.message), 'error');
        submit.disabled = false;
      }
    });
  }
}

/* -------------------------------------------------------------------- live */

export async function live() {
  await requireUser();

  const root = el('live-root');
  let config;
  let sessions = [];
  try {
    config = await api('/api/live/config');
    const result = await api('/api/live/sessions');
    sessions = result.sessions;
  } catch (error) {
    root.innerHTML = `<div class="empty"><strong>Could not load livestream settings</strong>${escapeHtml(error.message)}</div>`;
    return;
  }

  root.innerHTML = `
    <div class="notice ${config.configured ? 'ok' : 'warn'}">
      <strong>${config.configured ? `Livestream provider: ${escapeHtml(config.provider)}` : 'No livestream provider connected.'}</strong>
      ${escapeHtml(config.note)}
      ${
        config.configured
          ? ''
          : `<div class="small" style="margin-top:8px;">
               To enable real broadcasting, set <span class="mono">LIVE_PROVIDER</span>,
               <span class="mono">LIVE_INGEST_URL</span> and <span class="mono">LIVE_PLAYBACK_URL_TEMPLATE</span>
               in Settings → Environment variables. Free-tier option: LiveKit Cloud.
             </div>`
      }
    </div>

    <div class="grid cols-2" style="margin-bottom:24px;">
      <div class="panel">
        <h2>Schedule a stream</h2>
        <p class="hint">Creates a real session record. Going live stays disabled until a provider is configured.</p>
        <div id="live-status" hidden></div>
        <form id="live-form">
          <div class="field">
            <label for="live-title">Stream title</label>
            <input id="live-title" type="text" maxlength="120" placeholder="Friday build session" required />
          </div>
          <button class="button primary" type="submit">Create session</button>
        </form>
      </div>

      <div class="panel">
        <h2>Camera check</h2>
        <p class="hint">
          This previews your own camera in this browser only. It is not broadcast and no data leaves your device.
        </p>
        <video id="camera-preview" autoplay muted playsinline style="width:100%;border-radius:14px;background:#050914;aspect-ratio:16/9;"></video>
        <div class="row" style="margin-top:12px;">
          <button class="button secondary small" id="camera-start" type="button">Start camera</button>
          <button class="button ghost small" id="camera-stop" type="button">Stop</button>
        </div>
        <div id="camera-status"></div>
      </div>
    </div>

    <div class="panel">
      <h2>Sessions</h2>
      <p class="hint">${sessions.length ? `${sessions.length} session(s)` : 'No sessions yet.'}</p>
      ${
        sessions.length
          ? `<div class="table-wrap">
              <table>
                <thead><tr><th>Title</th><th>Creator</th><th>Status</th><th>Created</th><th>Playback</th><th></th></tr></thead>
                <tbody>
                  ${sessions
                    .map(
                      (s) => `<tr>
                        <td>${escapeHtml(s.title)}</td>
                        <td>${escapeHtml(s.owner)}</td>
                        <td>${statusPill(s.status)}</td>
                        <td class="nowrap muted small">${timeAgo(s.createdAt)}</td>
                        <td class="mono small">${s.playbackUrl ? escapeHtml(s.playbackUrl) : '<span class="muted">none</span>'}</td>
                        <td class="nowrap">
                          ${
                            s.mine && s.status === 'scheduled'
                              ? `<button class="button primary small" data-live="live" data-id="${s.id}" type="button">Go live</button>`
                              : ''
                          }
                          ${
                            s.mine && s.status === 'live'
                              ? `<button class="button danger small" data-live="ended" data-id="${s.id}" type="button">End stream</button>`
                              : ''
                          }
                        </td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="empty"><strong>Nothing scheduled</strong>Create a session to prepare a broadcast.</div>'
      }
    </div>`;

  const liveForm = el('live-form');
  if (liveForm) {
    liveForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = liveForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await api('/api/live/sessions', { method: 'POST', body: { title: el('live-title').value.trim() } });
        window.location.reload();
      } catch (error) {
        notice('live-status', escapeHtml(error.message), 'error');
        submit.disabled = false;
      }
    });
  }

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-live]');
    if (!button) return;
    button.disabled = true;
    try {
      await api(`/api/live/sessions/${button.dataset.id}`, { method: 'PATCH', body: { status: button.dataset.live } });
      window.location.reload();
    } catch (error) {
      notice('live-status', escapeHtml(error.message), 'error');
      button.disabled = false;
    }
  });

  // Local camera preview
  let stream = null;
  const preview = el('camera-preview');
  const startBtn = el('camera-start');
  const stopBtn = el('camera-stop');

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (preview) preview.srcObject = null;
    notice('camera-status', 'Camera stopped.', '');
  };

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        notice('camera-status', 'This browser does not expose a camera API.', 'error');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        preview.srcObject = stream;
        notice('camera-status', 'Camera active — local preview only, nothing is uploaded or broadcast.', 'ok');
      } catch (error) {
        notice(
          'camera-status',
          `Camera unavailable: ${escapeHtml(error.message)}. Permission may be blocked, or no device is connected.`,
          'error',
        );
      }
    });
  }
  if (stopBtn) stopBtn.addEventListener('click', stopCamera);
  window.addEventListener('pagehide', () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  });
}
