import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Covers the discovery endpoints behind the redesigned interface: categories,
 * search/category/channel filtering, channel pages, subscriptions, watch
 * history and notifications. Every assertion reads records the app really
 * wrote, so a regression in the feed or a leak of draft videos fails here.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 39000 + Math.floor(Math.random() * 4000);
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

async function signup(email, displayName) {
  const res = await request('/api/auth/signup', {
    method: 'POST',
    body: { email, password: `${email}-password-1`, displayName },
  });
  assert.equal(res.status, 201, `signup failed: ${res.text}`);
  return res;
}

async function publishVideo(cookie, fields) {
  const created = await request('/api/videos', { method: 'POST', cookie, body: fields });
  assert.equal(created.status, 201, `create failed: ${created.text}`);
  const id = created.json.video.id;
  const upload = await request(`/api/videos/${id}/file`, {
    method: 'PUT',
    cookie,
    raw: Buffer.from('test video payload'),
    headers: { 'content-type': 'video/mp4' },
  });
  assert.equal(upload.status, 200, `upload failed: ${upload.text}`);
  const published = await request(`/api/videos/${id}/publish`, { method: 'POST', cookie });
  assert.equal(published.status, 200, `publish failed: ${published.text}`);
  return id;
}

let owner; // first account -> admin
let creator;
let viewer;
let musicVideoId;
let draftVideoId;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'josh-platform-'));
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, MAX_UPLOAD_MB: '16' },
    stdio: 'ignore',
  });
  await waitForServer();

  owner = await signup('owner@platform.test', 'Owner');
  creator = await signup('creator@platform.test', 'Creator');
  viewer = await signup('viewer@platform.test', 'Viewer');

  musicVideoId = await publishVideo(creator.cookie, {
    title: 'Midnight synth session',
    description: 'Recorded live in one take.',
    category: 'Music',
  });
  draftVideoId = await publishVideo(creator.cookie, {
    title: 'Unlisted work in progress',
    description: 'Still editing.',
    category: 'Comedy',
  });
});

test.after(() => {
  if (child) child.kill('SIGKILL');
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('categories come from the server, not from hardcoded markup', async () => {
  const res = await request('/api/categories');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.categories) && res.json.categories.length > 0);
  assert.ok(res.json.categories.includes('Music'), 'Music must be a real category');

  const feed = await request('/api/videos');
  assert.deepEqual(feed.json.categories, res.json.categories, 'feed must expose the same list');
});

test('the feed filters by category, creator, search term and shorts only', async () => {
  const all = await request('/api/videos');
  assert.ok(all.json.videos.length >= 1);

  const music = await request('/api/videos?category=Music');
  assert.ok(music.json.videos.every((v) => (v.category || 'Other') === 'Music'));
  assert.ok(music.json.videos.some((v) => v.id === musicVideoId));

  const comedy = await request('/api/videos?category=Comedy');
  assert.equal(comedy.json.videos.some((v) => v.id === musicVideoId), false);

  const byCreator = await request(`/api/videos?channel=${creator.json.user.id}`);
  assert.equal(byCreator.json.videos.every((v) => v.userId === creator.json.user.id), true);

  const search = await request('/api/videos?q=midnight');
  assert.ok(search.json.videos.some((v) => v.id === musicVideoId));
  const miss = await request('/api/videos?q=no-such-video-term');
  assert.equal(miss.json.total, 0);

  const shorts = await request('/api/videos?shorts=1');
  assert.equal(shorts.json.videos.every((v) => Number(v.durationSec) <= 60), true);

  const byViews = await request('/api/videos?sort=views');
  assert.equal(byViews.status, 200);
});

test('a channel page lists only published videos with real totals', async () => {
  const res = await request(`/api/channels/${creator.json.user.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.channel.displayName, 'Creator');
  assert.equal(res.json.channel.videoCount, 1, 'the draft must not be counted publicly');
  assert.equal(res.json.videos.length, 1);
  assert.equal(res.json.subscribed, false);
  assert.equal(res.json.isOwner, false);
  assert.ok(Array.isArray(res.json.collections));
  assert.equal(res.json.collections[0].name, 'Music');
  assert.ok(res.json.collections[0].videos.some((v) => v.id === musicVideoId));

  const asOwner = await request(`/api/channels/${creator.json.user.id}`, { cookie: creator.cookie });
  assert.equal(asOwner.json.isOwner, true);

  const missing = await request('/api/channels/does-not-exist');
  assert.equal(missing.status, 404);
});

test('a draft video is invisible to everyone else', async () => {
  const detail = await request(`/api/videos/${draftVideoId}`);
  assert.equal(detail.status, 404, 'anonymous visitors must not read a draft');

  const asOwner = await request(`/api/videos/${draftVideoId}`, { cookie: creator.cookie });
  assert.equal(asOwner.status, 200);
  assert.equal(asOwner.json.owner, true);

  const feed = await request('/api/videos');
  assert.equal(feed.json.videos.some((v) => v.id === draftVideoId), false);
});

test('subscribing is authenticated, idempotent and reflected in the feed', async () => {
  const anonymous = await request(`/api/channels/${creator.json.user.id}/subscribe`, { method: 'POST' });
  assert.equal(anonymous.status, 401);

  const self = await request(`/api/channels/${creator.json.user.id}/subscribe`, {
    method: 'POST',
    cookie: creator.cookie,
  });
  assert.equal(self.status, 400, 'a creator cannot subscribe to themselves');

  const first = await request(`/api/channels/${creator.json.user.id}/subscribe`, {
    method: 'POST',
    cookie: viewer.cookie,
  });
  assert.equal(first.status, 200);
  assert.equal(first.json.subscribed, true);
  assert.equal(first.json.subscriberCount, 1);

  const again = await request(`/api/channels/${creator.json.user.id}/subscribe`, {
    method: 'POST',
    cookie: viewer.cookie,
  });
  assert.equal(again.json.subscriberCount, 1, 'subscribing twice must not double count');

  const subs = await request('/api/subscriptions', { cookie: viewer.cookie });
  assert.equal(subs.status, 200);
  assert.ok(subs.json.videos.some((v) => v.id === musicVideoId));
  assert.ok(subs.json.channels.some((c) => c.id === creator.json.user.id));
  assert.equal(subs.json.channels[0].subscriberCount, 1);

  const channel = await request(`/api/channels/${creator.json.user.id}`, { cookie: viewer.cookie });
  assert.equal(channel.json.subscribed, true);

  const removed = await request(`/api/channels/${creator.json.user.id}/subscribe`, {
    method: 'DELETE',
    cookie: viewer.cookie,
  });
  assert.equal(removed.json.subscribed, false);
  assert.equal(removed.json.subscriberCount, 0);

  const after = await request('/api/subscriptions', { cookie: viewer.cookie });
  assert.equal(after.json.videos.length, 0);
});

test('watch history records real views and can be cleared', async () => {
  const anonymous = await request('/api/history');
  assert.equal(anonymous.status, 401);

  const empty = await request('/api/history', { cookie: viewer.cookie });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.videos.length, 0);

  await request(`/api/videos/${musicVideoId}/view`, { method: 'POST', cookie: viewer.cookie });

  const recorded = await request('/api/history', { cookie: viewer.cookie });
  const entry = recorded.json.videos.find((v) => v.id === musicVideoId);
  assert.ok(entry, 'a watched video must appear in history');
  assert.ok(entry.watchedAt, 'history entries carry the real watch timestamp');

  const other = await request('/api/history', { cookie: owner.cookie });
  assert.equal(other.json.videos.length, 0, 'history is per account');

  const cleared = await request('/api/history', { method: 'DELETE', cookie: viewer.cookie });
  assert.equal(cleared.status, 200);
  const after = await request('/api/history', { cookie: viewer.cookie });
  assert.equal(after.json.videos.length, 0);
});

test('a comment produces a notification for the video owner only', async () => {
  const comment = await request(`/api/videos/${musicVideoId}/comments`, {
    method: 'POST',
    cookie: viewer.cookie,
    body: { body: 'That bassline is unreal.' },
  });
  assert.ok([200, 201].includes(comment.status), `comment failed: ${comment.text}`);

  const forCreator = await request('/api/notifications', { cookie: creator.cookie });
  assert.equal(forCreator.status, 200);
  const item = forCreator.json.notifications.find((n) => n.type === 'comment');
  assert.ok(item, 'the owner must be notified about the comment');
  assert.ok(item.title.includes('Viewer'));
  assert.equal(item.href, `/watch?v=${musicVideoId}`);
  assert.ok(forCreator.json.count >= 1);

  const forViewer = await request('/api/notifications', { cookie: viewer.cookie });
  assert.equal(
    forViewer.json.notifications.some((n) => n.type === 'comment'),
    false,
    'the commenter must not notify themselves',
  );

  const anonymous = await request('/api/notifications');
  assert.equal(anonymous.status, 401);
});

test('the public feed exposes no private fields', async () => {
  const feed = await request('/api/videos');
  const video = feed.json.videos.find((v) => v.id === musicVideoId);
  assert.ok(video);
  assert.equal(video.passwordHash, undefined);
  assert.equal(video.filePath, undefined);
  assert.equal(typeof video.creatorName, 'string');
});
