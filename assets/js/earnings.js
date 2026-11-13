/**
 * JOSH — earnings and USDT BEP20 withdrawals.
 * Figures come from the server's integer-micro-USDT ledger. Payments are not
 * connected, and the UI says so instead of implying money is flowing.
 */
import {
  mountShell,
  api,
  esc,
  icon,
  toast,
  setPageTitle,
  formatCount,
  timeAgo,
  emptyState,
  requireAuth,
} from './core.js';

const view = document.getElementById('view');

function money(usdt) {
  const n = Number(usdt || 0);
  return `${n.toFixed(2)} USDT`;
}

function statusPill(status) {
  const map = { pending: 'warn', approved: 'info', paid: 'ok', rejected: 'danger' };
  return `<span class="pill ${map[status] || 'info'}">${esc(status)}</span>`;
}

async function load() {
  const user = await requireAuth();
  if (!user) return;
  setPageTitle('Earnings');

  view.innerHTML = `<div class="page-head"><h1>Earnings</h1></div><div class="skeleton-block"></div>`;

  let data;
  let withdrawals = [];
  let minimum = '0.5';
  try {
    [data, withdrawals] = await Promise.all([
      api('/api/earnings/summary'),
      api('/api/withdrawals')
        .then((r) => {
          if (r && r.minimumWithdrawalUsdt) minimum = r.minimumWithdrawalUsdt;
          return (r && r.withdrawals) || [];
        })
        .catch(() => []),
    ]);
  } catch (err) {
    view.innerHTML = `<div class="page-head"><h1>Earnings</h1></div>`;
    view.appendChild(emptyState({ icon: 'alert', title: 'Could not load earnings', text: err.message }));
    return;
  }

  const totals = data.totals || {};
  const shares = data.shares || { creatorBps: 6000, platformBps: 4000 };
  const payments = data.payments || { active: false, note: '' };
  const ledger = data.ledger || data.revenue || [];
  const available = Number(totals.availableUsdt || 0);
  const creatorPct = (shares.creatorBps / 100).toFixed(0);
  const platformPct = (shares.platformBps / 100).toFixed(0);

  view.innerHTML = `<div class="page-head">
      <div>
        <h1>Earnings</h1>
        <p class="sub">Creators keep ${creatorPct}% of recorded revenue. The platform keeps ${platformPct}%.</p>
      </div>
      <div class="page-actions">
        <a class="btn ghost" href="/studio">${icon('chart', 16)} Studio</a>
      </div>
    </div>

    ${
      payments.active
        ? ''
        : `<div class="alert info">
            <strong>Payments are not connected.</strong>
            <span>${esc(payments.note || 'No payment provider is connected yet, so revenue appears here only when an administrator records a payment. Nothing is collected automatically.')}</span>
          </div>`
    }

    <div class="kpi-grid">
      <div class="kpi accent">
        <span class="kpi-label">Available to withdraw</span>
        <strong class="kpi-value">${money(totals.availableUsdt)}</strong>
        <span class="kpi-hint">after pending withdrawals</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Your ${creatorPct}% share</span>
        <strong class="kpi-value">${money(totals.creatorUsdt)}</strong>
        <span class="kpi-hint">lifetime</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Recorded revenue</span>
        <strong class="kpi-value">${money(totals.grossUsdt)}</strong>
        <span class="kpi-hint">gross, before split</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Platform ${platformPct}%</span>
        <strong class="kpi-value">${money(totals.platformUsdt)}</strong>
        <span class="kpi-hint">lifetime</span>
      </div>
    </div>

    <div class="split-grid">
      <section class="card pad">
        <div class="card-head"><h2>Withdraw USDT (BEP20)</h2><span class="pill info">BEP20</span></div>
        <form id="withdraw-form" class="form-grid" novalidate>
          <div class="field">
            <label for="amount">Amount (USDT)</label>
            <input class="input" id="amount" name="amount" inputmode="decimal" placeholder="${esc(minimum)}" required>
            <p class="hint">Minimum ${esc(minimum)} USDT. Available: ${money(totals.availableUsdt)}.</p>
          </div>
          <div class="field">
            <label for="address">BEP20 wallet address</label>
            <input class="input" id="address" name="address" placeholder="0x…" autocomplete="off" spellcheck="false" required>
            <p class="hint">BEP20 (BNB Smart Chain) address only — 42 characters starting with 0x.</p>
          </div>
          <div class="alert error hidden" id="wd-error" role="alert"></div>
          <button class="btn primary" type="submit" ${available <= 0 ? 'disabled' : ''}>
            ${icon('wallet', 16)} Request withdrawal
          </button>
          ${available <= 0 ? `<p class="hint">You need at least ${esc(minimum)} USDT available before a request can be made.</p>` : ''}
        </form>
      </section>

      <section class="card pad">
        <div class="card-head"><h2>How the split works</h2></div>
        <ul class="points">
          <li>Every recorded payment is split ${creatorPct}% to you and ${platformPct}% to the platform.</li>
          <li>Amounts are stored in integer micro-USDT, so rounding never creates or destroys a unit.</li>
          <li>Withdrawals are reviewed by an administrator before any transfer is sent.</li>
          <li>No transfer has been sent for a request until it is marked paid with a transaction hash.</li>
        </ul>
      </section>
    </div>

    <section class="card">
      <div class="card-head pad-x"><h2>Withdrawal requests</h2><span class="muted small">${withdrawals.length} total</span></div>
      ${
        withdrawals.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Requested</th><th class="num">Amount</th><th>Address</th><th>Status</th><th>Transaction</th></tr></thead>
              <tbody>${withdrawals
                .map(
                  (w) => `<tr>
                    <td>${esc(timeAgo(w.createdAt))}</td>
                    <td class="num">${money(w.amountUsdt)}</td>
                    <td class="mono truncate">${esc(w.address)}</td>
                    <td>${statusPill(w.status)}</td>
                    <td class="mono truncate">${w.txHash ? esc(w.txHash) : '<span class="muted">—</span>'}</td>
                  </tr>`
                )
                .join('')}</tbody>
            </table></div>`
          : emptyState({ icon: 'wallet', title: 'No withdrawal requests', text: 'When you request a payout it appears here with its review status.' })
      }
    </section>

    <section class="card">
      <div class="card-head pad-x"><h2>Revenue ledger</h2><span class="muted small">real recorded payments only</span></div>
      ${
        ledger.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Date</th><th>Source</th><th class="num">Gross</th><th class="num">Your ${creatorPct}%</th><th class="num">Platform ${platformPct}%</th></tr></thead>
              <tbody>${ledger
                .map(
                  (r) => `<tr>
                    <td>${esc(timeAgo(r.createdAt))}</td>
                    <td>${esc(r.source || '—')}${r.note ? `<span class="row-sub">${esc(r.note)}</span>` : ''}</td>
                    <td class="num">${money(r.grossUsdt)}</td>
                    <td class="num strong">${money(r.creatorUsdt)}</td>
                    <td class="num">${money(r.platformUsdt)}</td>
                  </tr>`
                )
                .join('')}</tbody>
            </table></div>`
          : emptyState({
              icon: 'chart',
              title: 'No revenue recorded yet',
              text: 'This ledger fills only when a real payment is recorded. Nothing here is estimated.',
            })
      }
    </section>`;

  const form = document.getElementById('withdraw-form');
  const errorBox = document.getElementById('wd-error');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/withdrawals', {
        method: 'POST',
        body: { amount: form.amount.value.trim(), address: form.address.value.trim() },
      });
      toast('Withdrawal requested — awaiting admin review');
      load();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

mountShell({ view: 'earnings' });
load();
