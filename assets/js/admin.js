/**
 * JOSH — private admin dashboard.
 * Access is enforced by the server on every request (requireAdmin); this module
 * only decides what to render after /api/admin/overview succeeds.
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
  emptyState,
  requireAuth,
  qs,
} from './core.js';

const view = document.getElementById('view');
let tab = qs('tab') || 'overview';

const TABS = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['videos', 'Videos'],
  ['withdrawals', 'Withdrawals'],
  ['revenue', 'Revenue'],
];

function tabsHTML() {
  return `<div class="tabs">${TABS.map(
    ([key, label]) =>
      `<a class="tab ${tab === key ? 'active' : ''}" href="/admin?tab=${key}" data-tab="${key}">${esc(label)}</a>`
  ).join('')}</div>`;
}

function statusPill(status) {
  const map = { pending: 'warn', approved: 'info', paid: 'ok', rejected: 'danger' };
  return `<span class="pill ${map[status] || 'info'}">${esc(status)}</span>`;
}

async function load() {
  const user = await requireAuth();
  if (!user) return;
  setPageTitle('Admin');

  if (user.role !== 'admin') {
    view.innerHTML = `<div class="page-head"><h1>Admin</h1></div>`;
    view.appendChild(
      emptyState({
        icon: 'lock',
        title: 'Administrator access required',
        text: 'Your account is not an administrator. The server refuses admin data for non-admin accounts, so nothing is shown here.',
        action: `<a class="btn ghost" href="/">Back to feed</a>`,
      })
    );
    return;
  }

  view.innerHTML = `<div class="page-head">
      <div><h1>Admin</h1><p class="sub">Private controls for users, content, revenue and payouts.</p></div>
      <div class="page-actions"><span class="pill ok">${icon('lock', 14)} restricted</span></div>
    </div>${tabsHTML()}<div id="panel"><div class="skeleton-block"></div></div>`;

  const panel = document.getElementById('panel');
  try {
    if (tab === 'users') return await renderUsers(panel);
    if (tab === 'videos') return await renderVideos(panel);
    if (tab === 'withdrawals') return await renderWithdrawals(panel);
    if (tab === 'revenue') return await renderRevenue(panel);
    return await renderOverview(panel);
  } catch (err) {
    panel.innerHTML = '';
    panel.appendChild(emptyState({ icon: 'alert', title: 'Could not load this panel', text: err.message }));
  }
}

async function renderOverview(panel) {
  const data = await api('/api/admin/overview');
  const c = data.counts || {};
  const rev = data.revenue || {};
  const wd = data.withdrawals || {};
  const pay = data.payments || { active: false, note: '' };

  panel.innerHTML = `
    ${
      pay.active
        ? ''
        : `<div class="alert info"><strong>Payments are not connected.</strong><span>${esc(
            pay.note || 'Revenue shown here exists only because an administrator recorded it.'
          )}</span></div>`
    }
    <div class="kpi-grid">
      <div class="kpi"><span class="kpi-label">Users</span><strong class="kpi-value">${formatCount(c.users || 0)}</strong><span class="kpi-hint">${c.creators || 0} creators · ${c.admins || 0} admins</span></div>
      <div class="kpi"><span class="kpi-label">Videos</span><strong class="kpi-value">${formatCount(c.videos || 0)}</strong><span class="kpi-hint">${c.published || 0} published</span></div>
      <div class="kpi"><span class="kpi-label">Views</span><strong class="kpi-value">${formatCount(c.views || 0)}</strong><span class="kpi-hint">${formatCount(c.comments || 0)} comments</span></div>
      <div class="kpi accent"><span class="kpi-label">Recorded revenue</span><strong class="kpi-value">${esc(rev.grossUsdt || '0.00')} USDT</strong><span class="kpi-hint">creator ${esc(rev.creatorUsdt || '0.00')} · platform ${esc(rev.platformUsdt || '0.00')}</span></div>
      <div class="kpi"><span class="kpi-label">Pending payouts</span><strong class="kpi-value">${esc(wd.pendingUsdt || '0.00')} USDT</strong><span class="kpi-hint">${wd.pending || 0} requests · ${wd.paid || 0} paid</span></div>
    </div>
    <div class="split-grid">
      <section class="card pad">
        <div class="card-head"><h2>Recent revenue entries</h2></div>
        ${
          (rev.rows || []).length
            ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>When</th><th>Creator</th><th>Source</th><th class="num">Gross</th></tr></thead><tbody>${rev.rows
                .slice(0, 8)
                .map(
                  (r) => `<tr><td>${esc(timeAgo(r.createdAt))}</td><td>${esc(r.creatorName || r.creatorId || '—')}</td><td>${esc(r.source || '—')}</td><td class="num">${esc(r.grossUsdt || r.amountUsdt || '0.00')}</td></tr>`
                )
                .join('')}</tbody></table></div>`
            : `<p class="muted">No revenue recorded yet.</p>`
        }
      </section>
      <section class="card pad">
        <div class="card-head"><h2>Quick actions</h2></div>
        <div class="stack gap-12">
          <a class="btn ghost" href="/admin?tab=withdrawals">Review withdrawal requests</a>
          <a class="btn ghost" href="/admin?tab=revenue">Record a payment</a>
          <a class="btn ghost" href="/admin?tab=users">Manage user roles</a>
        </div>
      </section>
    </div>`;
}

async function renderUsers(panel) {
  const data = await api('/api/admin/users');
  const users = data.users || [];
  panel.innerHTML = `<section class="card">
    <div class="card-head pad-x"><h2>Users</h2><span class="muted small">${users.length} accounts</span></div>
    ${
      users.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Account</th><th>Role</th><th class="num">Videos</th><th class="num">Views</th><th class="num">Earned</th><th class="num">Available</th><th></th></tr></thead>
            <tbody>${users
              .map(
                (u) => `<tr>
                  <td><span class="row-meta"><span class="row-title">${esc(u.displayName)}</span><span class="row-sub">${esc(u.email)}</span></span></td>
                  <td><span class="pill ${u.role === 'admin' ? 'ok' : 'info'}">${esc(u.role)}</span></td>
                  <td class="num">${formatCount(u.videos || 0)}</td>
                  <td class="num">${formatCount(u.views || 0)}</td>
                  <td class="num">${esc(u.earningsUsdt || '0.00')}</td>
                  <td class="num">${esc(u.availableUsdt || '0.00')}</td>
                  <td class="cell-actions">
                    <button class="btn sm ghost" data-role="${esc(u.id)}" data-next="${u.role === 'admin' ? 'creator' : 'admin'}">
                      ${u.role === 'admin' ? 'Make creator' : 'Make admin'}
                    </button>
                  </td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : `<p class="muted pad">No accounts yet.</p>`
    }
  </section>`;

  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;
    const nextRole = btn.dataset.next;
    const ok = await confirmDialog({
      title: nextRole === 'admin' ? 'Grant administrator access?' : 'Remove administrator access?',
      text: nextRole === 'admin' ? 'This account will be able to see and change all platform data.' : 'This account becomes a regular creator.',
      confirmText: nextRole === 'admin' ? 'Make admin' : 'Make creator',
      danger: nextRole !== 'admin',
    });
    if (!ok) return;
    try {
      await api(`/api/admin/users/${btn.dataset.role}`, { method: 'PATCH', body: { role: nextRole } });
      toast('Role updated');
      renderUsers(panel);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderVideos(panel) {
  const data = await api('/api/admin/videos');
  const videos = data.videos || [];
  panel.innerHTML = `<section class="card">
    <div class="card-head pad-x"><h2>All videos</h2><span class="muted small">${videos.length} total</span></div>
    ${
      videos.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Title</th><th>Creator</th><th>Status</th><th class="num">Views</th><th class="num">Likes</th><th></th></tr></thead>
            <tbody>${videos
              .map(
                (v) => `<tr>
                  <td>${esc(v.title)}<span class="row-sub">${esc(v.category || 'Other')}</span></td>
                  <td>${esc((v.creator && v.creator.displayName) || '—')}</td>
                  <td><span class="pill ${v.status === 'published' ? 'ok' : 'warn'}">${esc(v.status)}</span></td>
                  <td class="num">${formatCount(v.views)}</td>
                  <td class="num">${formatCount(v.likes)}</td>
                  <td class="cell-actions">
                    <a class="btn sm ghost" href="/watch?v=${esc(v.id)}">View</a>
                    <button class="btn sm danger" data-del="${esc(v.id)}" aria-label="Delete ${esc(v.title)}">${icon('trash', 15)}</button>
                  </td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : `<p class="muted pad">No videos uploaded yet.</p>`
    }
  </section>`;

  panel.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-del]')?.dataset.del;
    if (!id) return;
    const ok = await confirmDialog({
      title: 'Delete this video?',
      text: 'This removes the video for everyone. It cannot be undone.',
      confirmText: 'Delete video',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/videos/${id}`, { method: 'DELETE' });
      toast('Video deleted');
      renderVideos(panel);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function renderWithdrawals(panel) {
  const data = await api('/api/admin/withdrawals');
  const rows = data.withdrawals || [];
  panel.innerHTML = `<section class="card">
    <div class="card-head pad-x"><h2>Withdrawal requests</h2><span class="muted small">${rows.length} total</span></div>
    ${
      rows.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Requested</th><th>Creator</th><th class="num">Amount</th><th>Address</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${rows
              .map(
                (w) => `<tr data-wd="${esc(w.id)}">
                  <td>${esc(timeAgo(w.createdAt))}</td>
                  <td>${esc((w.user && w.user.displayName) || '—')}<span class="row-sub">${esc((w.user && w.user.email) || '')}</span></td>
                  <td class="num">${esc(w.amountUsdt)}</td>
                  <td class="mono truncate">${esc(w.address)}</td>
                  <td>${statusPill(w.status)}</td>
                  <td class="cell-actions">
                    ${
                      w.status === 'pending'
                        ? `<button class="btn sm primary" data-approve="${esc(w.id)}">Approve</button>
                           <button class="btn sm danger" data-reject="${esc(w.id)}">Reject</button>`
                        : ''
                    }
                    ${
                      w.status === 'approved'
                        ? `<button class="btn sm primary" data-pay="${esc(w.id)}">Mark paid</button>`
                        : ''
                    }
                    ${w.txHash ? `<span class="mono tiny truncate">${esc(w.txHash)}</span>` : ''}
                  </td>
                </tr>`
              )
              .join('')}</tbody></table></div>`
        : `<p class="muted pad">No withdrawal requests yet.</p>`
    }
  </section>`;

  panel.addEventListener('click', async (e) => {
    const approve = e.target.closest('[data-approve]')?.dataset.approve;
    const reject = e.target.closest('[data-reject]')?.dataset.reject;
    const pay = e.target.closest('[data-pay]')?.dataset.pay;

    /* The server expects { action: 'approve' | 'reject' | 'paid' }. */
    const act = async (id, body, message) => {
      try {
        await api(`/api/admin/withdrawals/${id}`, { method: 'PATCH', body });
        toast(message);
        renderWithdrawals(panel);
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    if (approve) {
      const ok = await confirmDialog({ title: 'Approve this request?', text: 'Approval marks it ready for payout. No transfer is sent automatically.', confirmText: 'Approve' });
      if (ok) act(approve, { action: 'approve' }, 'Request approved');
    } else if (reject) {
      const ok = await confirmDialog({ title: 'Reject this request?', text: 'The amount is released back to the creator.', confirmText: 'Reject', danger: true });
      if (ok) act(reject, { action: 'reject', note: '' }, 'Request rejected');
    } else if (pay) {
      const txHash = window.prompt('Transaction hash of the USDT BEP20 transfer (0x followed by 64 hex characters):', '');
      if (txHash === null) return;
      const clean = txHash.trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(clean)) {
        toast('Enter the BEP20 transaction hash (0x + 64 hex characters).', 'error');
        return;
      }
      act(pay, { action: 'paid', txHash: clean }, 'Marked as paid');
    }
  });
}

async function renderRevenue(panel) {
  const [usersData, videosData] = await Promise.all([
    api('/api/admin/users'),
    api('/api/admin/videos').catch(() => ({ videos: [] })),
  ]);
  const users = usersData.users || [];
  const videos = videosData.videos || [];

  panel.innerHTML = `<section class="card pad">
    <div class="card-head"><h2>Record a real payment</h2></div>
    <p class="hint mb-8">Only record money that was actually received. The 60/40 split is applied server-side in integer micro-USDT.</p>
    <form id="rev-form" class="form-grid" novalidate>
      <div class="field">
        <label for="creatorId">Creator</label>
        <select class="select" id="creatorId" name="creatorId" required>
          <option value="">Choose a creator…</option>
          ${users.map((u) => `<option value="${esc(u.id)}">${esc(u.displayName)} — ${esc(u.email)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="amount">Gross amount (USDT)</label>
        <input class="input" id="amount" name="amount" inputmode="decimal" placeholder="0.00" required>
      </div>
      <div class="field">
        <label for="source">Source</label>
        <input class="input" id="source" name="source" maxlength="60" placeholder="e.g. sponsor payment" required>
      </div>
      <div class="field">
        <label for="videoId">Related video (optional)</label>
        <select class="select" id="videoId" name="videoId">
          <option value="">No specific video</option>
          ${videos.map((v) => `<option value="${esc(v.id)}">${esc(v.title)}</option>`).join('')}
        </select>
      </div>
      <div class="alert error hidden" id="rev-error" role="alert"></div>
      <button class="btn primary" type="submit">${icon('wallet', 16)} Record payment</button>
    </form>
  </section>`;

  document.getElementById('rev-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = document.getElementById('rev-error');
    err.classList.add('hidden');
    try {
      await api('/api/admin/revenue', {
        method: 'POST',
        body: {
          creatorId: f.creatorId.value,
          amount: f.amount.value.trim(),
          source: f.source.value.trim(),
          videoId: f.videoId.value || null,
        },
      });
      toast('Payment recorded');
      renderRevenue(panel);
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove('hidden');
    }
  });
}

mountShell({ view: 'admin' });
load();
