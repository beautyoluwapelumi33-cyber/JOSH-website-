import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end test against a real server process with its own throwaway data
 * directory. Nothing is stubbed: these assertions read the same records the
 * deployed app reads, so they prove the flows rather than a mock of them.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const PORT = 34000 + Math.floor(Math.random() * 5000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;
let dataDir;

async function waitForServer(timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/status`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start in time');
}

/** Minimal cookie-aware request helper. */
async function request(pathname, { method = 'GET', body, cookie, raw, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.cookie = cookie;
  if (raw !== undefined) {
    init.body = raw;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const setCookie = res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie') || '';
  return { status: res.status, json, text, cookie: setCookie.split(';')[0] };
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'josh-test-'));
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, MAX_UPLOAD_MB: '16' },
    stdio: 'ignore',
  });
  await waitForServer();
});

test.after(() => {
  if (child) child.kill('SIGKILL');
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('status endpoint reports the local store honestly', async () => {
  const res = await request('/api/status');
  assert.equal(res.status, 200);
  assert.ok(res.json.supabase, 'status must describe Supabase connectivity');
  assert.equal(res.json.supabase.configured, false);
});

test('the first account becomes an admin, later accounts are creators', async () => {
  const first = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'owner@josh.test', password: 'owner-password-1', displayName: 'Owner' },
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.user.role, 'admin');
  assert.equal(first.json.firstAccount, true);
  assert.ok(first.cookie, 'signup must set a session cookie');
  assert.equal(first.json.user.passwordHash, undefined, 'never return the password hash');

  const second = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1', displayName: 'Creator' },
  });
  assert.equal(second.status, 201);
  assert.equal(second.json.user.role, 'creator');
  assert.equal(second.json.firstAccount, false);
});

test('duplicate email and weak passwords are rejected', async () => {
  const dup = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'owner@josh.test', password: 'owner-password-1' },
  });
  assert.equal(dup.status, 409);

  const weak = await request('/api/auth/signup', {
    method: 'POST',
    body: { email: 'weak@josh.test', password: 'short' },
  });
  assert.equal(weak.status, 400);
});

test('wrong password is refused and correct password signs in', async () => {
  const bad = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'definitely-wrong' },
  });
  assert.equal(bad.status, 401);

  const good = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });
  assert.equal(good.status, 200);
  assert.equal(good.json.user.email, 'creator@josh.test');
});

test('a creator cannot read the admin dashboard', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });
  const res = await request('/api/admin/overview', { cookie: login.cookie });
  assert.equal(res.status, 403, 'role checks must be enforced by the server');
});

test('anonymous visitors cannot create videos or read earnings', async () => {
  const create = await request('/api/videos', { method: 'POST', body: { title: 'Nope nope' } });
  assert.equal(create.status, 401);
  const earnings = await request('/api/earnings/summary');
  assert.equal(earnings.status, 401);
});

test('upload, publish and watch produce genuine statistics', async () => {
  const creator = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });

  const created = await request('/api/videos', {
    method: 'POST',
    cookie: creator.cookie,
    body: { title: 'My first real video', description: 'Recorded for this test.' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.video.status, 'draft');
  const videoId = created.json.video.id;

  const publishEarly = await request(`/api/videos/${videoId}/publish`, {
    method: 'POST',
    cookie: creator.cookie,
  });
  assert.equal(publishEarly.status, 400, 'a video with no file must not publish');

  const upload = await request(`/api/videos/${videoId}/file`, {
    method: 'PUT',
    cookie: creator.cookie,
    raw: Buffer.from('fake mp4 bytes for the test suite'),
    headers: { 'content-type': 'video/mp4' },
  });
  assert.equal(upload.status, 200, `upload failed: ${upload.text}`);

  const published = await request(`/api/videos/${videoId}/publish`, {
    method: 'POST',
    cookie: creator.cookie,
  });
  assert.equal(published.status, 200);
  assert.equal(published.json.video.status, 'published');

  const feed = await request('/api/videos');
  assert.equal(feed.status, 200);
  const inFeed = feed.json.videos.find((v) => v.id === videoId);
  assert.ok(inFeed, 'published video must appear in the public feed');
  assert.equal(inFeed.views, 0);

  const view = await request(`/api/videos/${videoId}/view`, { method: 'POST' });
  assert.ok([200, 204].includes(view.status));

  const detail = await request(`/api/videos/${videoId}`);
  assert.equal(detail.json.video.views, 1, 'the view counter must reflect a real view');

  const stats = await request('/api/stats/public');
  assert.equal(stats.json.videos, 1);
  assert.equal(stats.json.views, 1);
  assert.equal(stats.json.creators, 1);
});

test('studio and earnings start at zero instead of invented figures', async () => {
  const creator = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });

  const studio = await request('/api/studio/summary', { cookie: creator.cookie });
  assert.equal(studio.status, 200);
  assert.equal(studio.json.totals.views, 1);

  const earnings = await request('/api/earnings/summary', { cookie: creator.cookie });
  assert.equal(earnings.status, 200);
  assert.equal(earnings.json.payments.active, false, 'payments must not be presented as active');
  assert.equal(earnings.json.shares.creatorBps, 6000);
  assert.equal(earnings.json.shares.platformBps, 4000);
  assert.equal(earnings.json.totals.creatorUsdt, '0.00');
});

test('a withdrawal needs 0.5 USDT available and a valid BEP20 address', async () => {
  const creator = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });

  const tooSmall = await request('/api/withdrawals', {
    method: 'POST',
    cookie: creator.cookie,
    body: { amount: '0.4', address: ADDRESS },
  });
  assert.equal(tooSmall.status, 400);
  assert.match(tooSmall.text, /0\.5 USDT/);

  const badAddress = await request('/api/withdrawals', {
    method: 'POST',
    cookie: creator.cookie,
    body: { amount: '0.5', address: 'not-a-wallet' },
  });
  assert.equal(badAddress.status, 400);

  const noFunds = await request('/api/withdrawals', {
    method: 'POST',
    cookie: creator.cookie,
    body: { amount: '0.5', address: ADDRESS },
  });
  assert.equal(noFunds.status, 400, 'cannot withdraw money that was never earned');
});

test('recorded revenue splits 60/40 and funds a withdrawal request', async () => {
  const admin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'owner@josh.test', password: 'owner-password-1' },
  });
  const creator = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });
  const creatorId = creator.json.user.id;

  const recorded = await request('/api/admin/revenue', {
    method: 'POST',
    cookie: admin.cookie,
    body: { creatorId, amount: '10', source: 'Test sponsorship' },
  });
  assert.ok(recorded.status < 300, `recording revenue failed: ${recorded.text}`);

  const summary = await request('/api/earnings/summary', { cookie: creator.cookie });
  assert.equal(summary.json.totals.grossUsdt, '10.00');
  assert.equal(summary.json.totals.creatorUsdt, '6.00');
  assert.equal(summary.json.totals.platformUsdt, '4.00');
  assert.equal(summary.json.totals.availableUsdt, '6.00');

  const requested = await request('/api/withdrawals', {
    method: 'POST',
    cookie: creator.cookie,
    body: { amount: '5', address: ADDRESS },
  });
  assert.equal(requested.status, 201);
  assert.equal(requested.json.withdrawal.status, 'pending');
  assert.match(requested.json.note, /No transfer has been sent/i, 'never imply money moved');

  const after = await request('/api/earnings/summary', { cookie: creator.cookie });
  assert.equal(after.json.totals.availableUsdt, '1.00', 'pending requests hold their funds');

  const overAsk = await request('/api/withdrawals', {
    method: 'POST',
    cookie: creator.cookie,
    body: { amount: '2', address: ADDRESS },
  });
  assert.equal(overAsk.status, 400, 'cannot request more than the remaining balance');
});

test('a creator cannot grant themselves admin rights', async () => {
  const creator = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });
  const res = await request(`/api/admin/users/${creator.json.user.id}`, {
    method: 'PATCH',
    cookie: creator.cookie,
    body: { role: 'admin' },
  });
  assert.equal(res.status, 403);
});

test('logout invalidates the session cookie', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'creator@josh.test', password: 'creator-password-1' },
  });
  const me = await request('/api/auth/me', { cookie: login.cookie });
  assert.equal(me.json.user.email, 'creator@josh.test');

  await request('/api/auth/logout', { method: 'POST', cookie: login.cookie });

  const after = await request('/api/auth/me', { cookie: login.cookie });
  assert.equal(after.json.user, null);
});
