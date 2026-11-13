import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREATOR_SHARE_BPS,
  PLATFORM_SHARE_BPS,
  MIN_WITHDRAWAL_MICRO,
  splitRevenue,
  sumRevenue,
  formatUsdt,
  parseUsdt,
  validateWithdrawal,
  availableBalance,
} from '../server/earnings.js';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

test('share constants are 60/40 and total 100%', () => {
  assert.equal(CREATOR_SHARE_BPS, 6000);
  assert.equal(PLATFORM_SHARE_BPS, 4000);
  assert.equal(CREATOR_SHARE_BPS + PLATFORM_SHARE_BPS, 10_000);
});

test('splitRevenue gives the creator exactly 60%', () => {
  const split = splitRevenue(10_000_000); // 10 USDT
  assert.equal(split.creatorMicro, 6_000_000);
  assert.equal(split.platformMicro, 4_000_000);
  assert.equal(split.totalMicro, 10_000_000);
});

test('splitRevenue never creates or loses a micro-unit', () => {
  for (const total of [1, 7, 999, 1_234_567, 999_999_999]) {
    const split = splitRevenue(total);
    assert.equal(
      split.creatorMicro + split.platformMicro,
      total,
      `micro-units must balance for ${total}`,
    );
  }
});

test('creator share is floored, never rounded up past 60%', () => {
  // 1 micro: 60% is 0.6 micro, so the creator gets 0 and the platform keeps 1.
  assert.equal(splitRevenue(1).creatorMicro, 0);
  assert.equal(splitRevenue(1).platformMicro, 1);
});

test('negative and non-numeric revenue is treated as zero', () => {
  assert.equal(splitRevenue(-500).totalMicro, 0);
  assert.equal(splitRevenue('abc').totalMicro, 0);
  assert.equal(splitRevenue(null).creatorMicro, 0);
});

test('sumRevenue aggregates gross, creator and platform totals', () => {
  const rows = [{ amountMicro: 1_000_000 }, { amountMicro: 500_000 }];
  const totals = sumRevenue(rows);
  assert.equal(totals.grossMicro, 1_500_000);
  assert.equal(totals.creatorMicro, 900_000);
  assert.equal(totals.platformMicro, 600_000);
  assert.equal(totals.creatorMicro + totals.platformMicro, totals.grossMicro);
});

test('sumRevenue of no rows is zero, not a fabricated figure', () => {
  assert.deepEqual(sumRevenue([]), { grossMicro: 0, creatorMicro: 0, platformMicro: 0 });
});

test('parseUsdt accepts decimals up to 6 places', () => {
  assert.equal(parseUsdt('0.5'), 500_000);
  assert.equal(parseUsdt('12.75'), 12_750_000);
  assert.equal(parseUsdt('1.234567'), 1_234_567);
  assert.equal(parseUsdt('10'), 10_000_000);
});

test('parseUsdt rejects malformed or over-precise amounts', () => {
  for (const bad of ['', 'abc', '-1', '1.2345678', '1,5', '0x10', null, undefined]) {
    assert.equal(parseUsdt(bad), null, `expected null for ${String(bad)}`);
  }
});

test('formatUsdt renders two decimal places', () => {
  assert.equal(formatUsdt(500_000), '0.50');
  assert.equal(formatUsdt(0), '0.00');
  assert.equal(formatUsdt(12_345_678), '12.35');
});

test('the 0.5 USDT minimum is enforced', () => {
  assert.equal(MIN_WITHDRAWAL_MICRO, 500_000);
  const below = validateWithdrawal({
    amountMicro: 499_999,
    address: ADDRESS,
    availableMicro: 10_000_000,
  });
  assert.equal(below.ok, false);
  assert.match(below.error, /0\.5 USDT/);

  const atMinimum = validateWithdrawal({
    amountMicro: 500_000,
    address: ADDRESS,
    availableMicro: 10_000_000,
  });
  assert.equal(atMinimum.ok, true);
});

test('withdrawals above the available balance are refused', () => {
  const result = validateWithdrawal({
    amountMicro: 2_000_000,
    address: ADDRESS,
    availableMicro: 1_000_000,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /available balance/i);
});

test('only well-formed BEP20 addresses are accepted', () => {
  for (const bad of ['', '0x123', '1234567890abcdef1234567890abcdef12345678', '0xZZZ4567890abcdef1234567890abcdef12345678']) {
    assert.equal(validateWithdrawal({ amountMicro: 500_000, address: bad }).ok, false);
  }
  assert.equal(validateWithdrawal({ amountMicro: 500_000, address: ADDRESS }).ok, true);
});

test('available balance holds back pending, approved and paid requests', () => {
  const withdrawals = [
    { amountMicro: 500_000, status: 'pending' },
    { amountMicro: 250_000, status: 'approved' },
    { amountMicro: 100_000, status: 'paid' },
    { amountMicro: 900_000, status: 'rejected' },
  ];
  assert.equal(availableBalance(2_000_000, withdrawals), 1_150_000);
});

test('available balance never goes negative', () => {
  assert.equal(availableBalance(100_000, [{ amountMicro: 500_000, status: 'paid' }]), 0);
});
