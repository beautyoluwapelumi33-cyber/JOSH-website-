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
import { formatDuration } from './views.js';

/* ------------------------------------------------------------------ studio */

export async function studio() {
  const user = await requireUser();
  if (!user) return;

  const root = el('studio-root');
  let data;
  try {
    data = await api('/api/studio/summary');
  } catch (error) {
    root.innerHTML = `<div class="empty"><strong>Could not load your studio</strong>${escapeHtml(error.message)}</div>`;
    return;
  }

  const { totals, dailyViews, videos } = data;
  const peak = Math.max(1, ...dailyViews.map((d) => d.views));

  root.innerHTML = `
    <div class="stats" style="margin-bottom:24px;">
      <div class="stat"><strong>${compact(totals.videos)}</strong><span>Videos</span></div>
      <div class="stat"><strong>${compact(totals.published)}</strong><span>Published</span></div>
      <div class="stat"><strong>${compact(totals.views)}</strong><span>Views</span></div>
      <div class="stat"><strong>${compact(totals.likes)}</strong><span>Likes</span></div>
      <div class="stat"><strong>${compact(totals.comments)}</strong><span>Comments</span></div>
    </div>

    <div class="panel" style="margin-bottom:24px;">
      <div class="spread">
        <div>
          <h2>Views, last 14 days</h2>
          <p class="hint" style="margin-bottom:0;">Recorded from real playback starts, de-duplicated per viewer for 30 minutes.</p>
        </div>
        <span class="pill">${compact(totals.views)} total</span>
      </div>
      <div class="chart">
        ${dailyViews
          .map(
            (d) => `<div class="bar" style="height:${Math.round((d.views / peak) * 100)}%" title="${d.views} views on ${d.date}">
              <span>${d.date.slice(8)}</span></div>`,
          )
          .join('')}
      </div>
      <div style="height:22px;"></div>
    </div>

    <div class="panel">
      <div class="spread" style="margin-bottom:16px;">
        <div>
          <h2>Your videos</h2>
          <p class="hint" style="margin-bottom:0;">Everything here is measured from your own uploads.</p>
        </div>
        <a class="button primary small" href="/upload">Upload video</a>
      </div>
      ${
        videos.length
          ? `<div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Video</th><th>Status</th><th>Views</th><th>Likes</th><th>Comments</th><th>Uploaded</th><th></th></tr>
                </thead>
                <tbody>
                  ${videos
                    .map(
                      (v) => `
                    <tr data-video="${v.id}">
                      <td>
                        <a href="/watch?v=${v.id}"><strong>${escapeHtml(v.title)}</strong></a>
                        ${v.durationSec ? `<div class="small muted">${formatDuration(v.durationSec)}</div>` : ''}
                      </td>
                      <td>${statusPill(v.status)}</td>
                      <td class="amount">${compact(v.views)}</td>
                      <td class="amount">${compact(v.likes)}</td>
                      <td class="amount">${compact(v.comments)}</td>
                      <td class="nowrap muted small">${timeAgo(v.createdAt)}</td>
                      <td class="nowrap">
                        ${v.status === 'draft' ? `<button class="button secondary small" data-action="publish" data-id="${v.id}" type="button">Publish</button>` : ''}
                        <button class="button danger small" data-action="delete" data-id="${v.id}" type="button">Delete</button>
                      </td>
                    </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : `<div class="empty">
              <strong>You have not uploaded anything yet</strong>
              Your videos, views and engagement will appear here as soon as you publish.
              <div style="margin-top:14px;"><a class="button primary" href="/upload">Upload your first video</a></div>
            </div>`
      }
    </div>
    <div id="studio-error"></div>`;

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;

    if (action === 'publish') {
      button.disabled = true;
      try {
        await api(`/api/videos/${id}/publish`, { method: 'POST' });
        window.location.reload();
      } catch (error) {
        notice('studio-error', escapeHtml(error.message), 'error');
        button.disabled = false;
      }
    }

    if (action === 'delete') {
      if (!window.confirm('Delete this video permanently? Views and comments are removed too.')) return;
      button.disabled = true;
      try {
        await api(`/api/videos/${id}`, { method: 'DELETE' });
        window.location.reload();
      } catch (error) {
        notice('studio-error', escapeHtml(error.message), 'error');
        button.disabled = false;
      }
    }
  });
}

/* ---------------------------------------------------------------- earnings */

export async function earnings() {
  const user = await requireUser();
  if (!user) return;

  const root = el('earnings-root');
  let data;
  try {
    data = await api('/api/earnings/summary');
  } catch (error) {
    root.innerHTML = `<div class="empty"><strong>Could not load earnings</strong>${escapeHtml(error.message)}</div>`;
    return;
  }

  const { totals, ledger, withdrawals, shares, payments, minimumWithdrawalUsdt } = data;

  root.innerHTML = `
    <div class="notice warn">
      <strong>Payments are not active.</strong>
      ${escapeHtml(payments.note)} Nothing below is an estimate or a projection — every figure comes from a payment an administrator recorded.
    </div>

    <div class="stats" style="margin-bottom:24px;">
      <div class="stat"><strong>${escapeHtml(totals.grossUsdt)}</strong><span>Gross revenue (USDT)</span></div>
      <div class="stat"><strong>${escapeHtml(totals.creatorUsdt)}</strong><span>Your 60% share</span></div>
      <div class="stat"><strong>${escapeHtml(totals.platformUsdt)}</strong><span>Platform 40%</span></div>
      <div class="stat"><strong>${escapeHtml(totals.availableUsdt)}</strong><span>Available to withdraw</span></div>
    </div>

    <div class="grid cols-2" style="margin-bottom:24px;">
      <div class="panel">
        <h2>Revenue split</h2>
        <p class="hint">Applied to every recorded payment, rounded down to the micro-unit so nothing is invented.</p>
        <div class="row" style="justify-content:space-between;margin-bottom:10px;">
          <span class="small muted">Creator</span><span class="amount">${(shares.creatorBps / 100).toFixed(0)}%</span>
        </div>
        <div class="progress"><span style="width:${shares.creatorBps / 100}%;"></span></div>
        <div class="row" style="justify-content:space-between;margin:16px 0 10px;">
          <span class="small muted">Platform</span><span class="amount">${(shares.platformBps / 100).toFixed(0)}%</span>
        </div>
        <div class="progress"><span style="width:${shares.platformBps / 100}%;background:linear-gradient(90deg,#22c55e,#4ade80);"></span></div>
      </div>

      <div class="panel">
        <h2>Withdraw USDT</h2>
        <p class="hint">Minimum ${escapeHtml(minimumWithdrawalUsdt)} USDT. BEP20 (BNB Smart Chain) only.</p>
        <div id="withdraw-status" hidden></div>
        <form id="withdraw-form">
          <div class="field">
            <label for="withdraw-amount">Amount (USDT)</label>
            <input id="withdraw-amount" name="amount" type="text" inputmode="decimal" placeholder="${escapeHtml(minimumWithdrawalUsdt)}" required />
            <span class="help">Available: ${escapeHtml(totals.availableUsdt)} USDT</span>
          </div>
          <div class="field">
            <label for="withdraw-address">BEP20 wallet address</label>
            <input id="withdraw-address" name="address" type="text" placeholder="0x…" required autocomplete="off" spellcheck="false" />
            <span class="help">0x followed by 40 hexadecimal characters. Double-check it — transfers cannot be reversed.</span>
          </div>
          <button class="button primary" type="submit" id="withdraw-submit">Request withdrawal</button>
        </form>
      </div>
    </div>

    <div class="panel" style="margin-bottom:24px;">
      <h2>Revenue ledger</h2>
      <p class="hint">One row per payment that actually happened.</p>
      ${
        ledger.length
          ? `<div class="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Source</th><th>Gross</th><th>Your 60%</th><th>Platform 40%</th></tr></thead>
                <tbody>
                  ${ledger
                    .map(
                      (row) => `<tr>
                        <td class="nowrap muted small">${timeAgo(row.createdAt)}</td>
                        <td>${escapeHtml(row.source)}${row.note ? `<div class="small muted">${escapeHtml(row.note)}</div>` : ''}</td>
                        <td class="amount">${escapeHtml(row.grossUsdt)}</td>
                        <td class="amount">${escapeHtml(row.creatorUsdt)}</td>
                        <td class="amount">${escapeHtml(row.platformUsdt)}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : `<div class="empty">
              <strong>No revenue recorded yet</strong>
              Earnings appear here only when a real payment is received and recorded by an administrator.
              No payment provider is connected, so there is nothing to report — and nothing is simulated.
            </div>`
      }
    </div>

    <div class="panel">
      <h2>Withdrawal requests</h2>
      <p class="hint">A request is a claim on your balance. Money moves only when an administrator settles it and records the on-chain transaction hash.</p>
      ${
        withdrawals.length
          ? `<div class="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>Address</th><th>Transaction</th></tr></thead>
                <tbody>
                  ${withdrawals
                    .map(
                      (w) => `<tr>
                        <td class="nowrap muted small">${timeAgo(w.createdAt)}</td>
                        <td class="amount">${escapeHtml(w.amountUsdt)}</td>
                        <td>${statusPill(w.status)}</td>
                        <td class="mono">${escapeHtml(w.address.slice(0, 10))}…${escapeHtml(w.address.slice(-6))}</td>
                        <td class="mono">${w.txHash ? `${escapeHtml(w.txHash.slice(0, 12))}…` : '<span class="muted">not sent</span>'}</td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
          : '<div class="empty"><strong>No withdrawal requests</strong>Your requests and their settlement status will be listed here.</div>'
      }
    </div>`;

  const form = el('withdraw-form');
  const status = el('withdraw-status');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = el('withdraw-submit');
      button.disabled = true;
      try {
        const result = await api('/api/withdrawals', {
          method: 'POST',
          body: { amount: el('withdraw-amount').value.trim(), address: el('withdraw-address').value.trim() },
        });
        notice(
          status,
          `Request for ${escapeHtml(result.withdrawal.amountUsdt)} USDT recorded with status <strong>pending</strong>. ${escapeHtml(result.note || '')}`,
          'ok',
        );
        form.reset();
        setTimeout(() => window.location.reload(), 2200);
      } catch (error) {
        notice(status, escapeHtml(error.message), 'error');
        button.disabled = false;
      }
    });
  }
}
