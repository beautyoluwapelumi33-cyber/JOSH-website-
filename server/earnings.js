/**
 * Revenue sharing and withdrawal rules.
 *
 * All money is handled as integer micro-USDT (1 USDT = 1_000_000 micro).
 * Integers avoid floating point drift in balances, which matters because a
 * withdrawal is refused or accepted based on an exact comparison.
 */

export const CREATOR_SHARE_BPS = 6000; // 60.00%
export const PLATFORM_SHARE_BPS = 4000; // 40.00%
export const MICRO = 1_000_000;
export const MIN_WITHDRAWAL_MICRO = 500_000; // 0.5 USDT

/** BEP20 (BNB Smart Chain) addresses are EVM addresses: 0x + 40 hex chars. */
export const BEP20_RE = /^0x[0-9a-fA-F]{40}$/;
/** BEP20 transaction hashes: 0x + 64 hex chars. */
export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Split one revenue amount between creator and platform.
 * The creator receives exactly 60%, the platform keeps the remainder, so no
 * micro-unit is ever created or lost by rounding.
 */
export function splitRevenue(totalMicro) {
  const total = Math.max(0, Math.trunc(Number(totalMicro) || 0));
  const creatorMicro = Math.floor((total * CREATOR_SHARE_BPS) / 10_000);
  return {
    totalMicro: total,
    creatorMicro,
    platformMicro: total - creatorMicro,
  };
}

/** Sum a list of revenue rows into gross / creator / platform totals. */
export function sumRevenue(rows) {
  return rows.reduce(
    (acc, row) => {
      const split = splitRevenue(row.amountMicro);
      acc.grossMicro += split.totalMicro;
      acc.creatorMicro += split.creatorMicro;
      acc.platformMicro += split.platformMicro;
      return acc;
    },
    { grossMicro: 0, creatorMicro: 0, platformMicro: 0 },
  );
}

/** Format micro-USDT for display, e.g. 1500000 -> "1.50". */
export function formatUsdt(micro) {
  const value = Number(micro) || 0;
  return (value / MICRO).toFixed(2);
}

/** Parse a user-entered USDT amount ("0.5", "12.75") into micro units. */
export function parseUsdt(input) {
  const raw = String(input ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const micro = Number(whole) * MICRO + Number(fraction.padEnd(6, '0'));
  if (!Number.isSafeInteger(micro)) return null;
  return micro;
}

/**
 * Validate a withdrawal request before it is written anywhere.
 * Returns { ok: true } or { ok: false, error }.
 */
export function validateWithdrawal({ amountMicro, address, availableMicro }) {
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) {
    return { ok: false, error: 'Enter a valid USDT amount.' };
  }
  if (amountMicro < MIN_WITHDRAWAL_MICRO) {
    return { ok: false, error: 'The minimum withdrawal is 0.5 USDT.' };
  }
  if (!BEP20_RE.test(String(address ?? '').trim())) {
    return { ok: false, error: 'Enter a valid BEP20 wallet address (0x followed by 40 hex characters).' };
  }
  if (Number.isSafeInteger(availableMicro) && amountMicro > availableMicro) {
    return { ok: false, error: 'That amount is more than your available balance.' };
  }
  return { ok: true };
}

/**
 * Available balance = creator share of recorded revenue, minus withdrawals that
 * are still going to be paid out (pending, approved or already paid).
 * Rejected requests release their funds automatically.
 */
export function availableBalance(creatorMicro, withdrawals) {
  const held = withdrawals
    .filter((w) => ['pending', 'approved', 'paid'].includes(w.status))
    .reduce((sum, w) => sum + (Number(w.amountMicro) || 0), 0);
  return Math.max(0, creatorMicro - held);
}
