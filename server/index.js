import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadDb, saveDb, UPLOAD_DIR, dataDir } from './store.js';
import {
  hashPassword,
  verifyPassword,
  passwordProblem,
  emailProblem,
  newToken,
  SESSION_TTL_MS,
  SESSION_COOKIE,
  parseCookies,
  sessionCookie,
  clearCookie,
  viewerKey,
} from './auth.js';
import {
  splitRevenue,
  sumRevenue,
  formatUsdt,
  parseUsdt,
  validateWithdrawal,
  availableBalance,
  MIN_WITHDRAWAL_MICRO,
  CREATOR_SHARE_BPS,
  PLATFORM_SHARE_BPS,
  BEP20_RE,
  TX_HASH_RE,
  MICRO,
} from './earnings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 128) * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;
const VIEW_DEDUPE_MS = 30 * 60 * 1000;
const SESSION_SECRET_PRESENT = Boolean(process.env.SESSION_SECRET);

const SUPABASE = {
  url: process.env.SUPABASE_URL || '',
  anonKey: process.env.SUPABASE_ANON_KEY || '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
};
const supabaseConfigured = Boolean(SUPABASE.url && SUPABASE.serviceKey);
const LIVE_PROVIDER = process.env.LIVE_PROVIDER || '';

const db = loadDb();

/* ------------------------------------------------------------------ helpers */

const nowIso = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fail(res, status, error, extra = {}) {
  sendJson(res, status, { error, ...extra });
}

async function readJsonBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    db.sessions = db.sessions.filter((s) => s.token !== token);
    saveDb();
    return null;
  }
  return db.users.find((u) => u.id === session.userId) || null;
}

function startSession(req, res, user) {
  const token = newToken();
  db.sessions.push({
    token,
    userId: user.id,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  });
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
  saveDb();
  const secure =
    String(req.headers['x-forwarded-proto'] || '').includes('https') ||
    Boolean(req.socket.encrypted);
  res.setHeader('Set-Cookie', sessionCookie(token, { secure }));
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    fail(res, 401, 'Sign in to continue.');
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    fail(res, 403, 'Administrator access is required.');
    return null;
  }
  return user;
}

function countsByVideo() {
  const views = new Map();
  const likes = new Map();
  const comments = new Map();
  for (const v of db.views) views.set(v.videoId, (views.get(v.videoId) || 0) + 1);
  for (const l of db.likes) likes.set(l.videoId, (likes.get(l.videoId) || 0) + 1);
  for (const c of db.comments) comments.set(c.videoId, (comments.get(c.videoId) || 0) + 1);
  return { views, likes, comments };
}

function creatorName(video) {
  const owner = db.users.find((u) => u.id === video.userId);
  return owner ? owner.displayName : 'Unknown creator';
}

function videoSummary(video, counts = countsByVideo()) {
  return {
    id: video.id,
    title: video.title,
    description: video.description || '',
    status: video.status,
    createdAt: video.createdAt,
    publishedAt: video.publishedAt || null,
    durationSec: video.durationSec || null,
    sizeBytes: video.sizeBytes || 0,
    hasThumbnail: Boolean(video.thumbMime),
    creator: { id: video.userId, displayName: creatorName(video) },
    views: counts.views.get(video.id) || 0,
    likes: counts.likes.get(video.id) || 0,
    comments: counts.comments.get(video.id) || 0,
  };
}

function canWatch(video, user) {
  if (!video) return false;
  if (video.status === 'published') return true;
  if (!user) return false;
  return user.id === video.userId || user.role === 'admin';
}

function creatorRevenue(creatorId) {
  return db.revenue.filter((r) => r.creatorId === creatorId);
}

function earningsFor(user) {
  const rows = creatorRevenue(user.id);
  const totals = sumRevenue(rows);
  const withdrawals = db.withdrawals.filter((w) => w.userId === user.id);
  return {
    totals,
    withdrawals,
    availableMicro: availableBalance(totals.creatorMicro, withdrawals),
  };
}

/* ------------------------------------------------------------ rate limiting */

const rateBuckets = new Map();
function rateLimited(req, key, limit, windowMs) {
  const ip = req.socket.remoteAddress || 'unknown';
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const bucket = rateBuckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  return bucket.count > limit;
}

/* ----------------------------------------------------------------- routing */

const routes = [];
function route(method, pattern, handler) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ method, parts, handler });
}

function matchRoute(method, pathname) {
  const segments = pathname.split('/').filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < candidate.parts.length; i += 1) {
      const part = candidate.parts[i];
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[i]);
      else if (part !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: candidate.handler, params };
  }
  return null;
}

/* -------------------------------------------------------------------- auth */

route('POST', '/api/auth/signup', async (req, res) => {
  if (rateLimited(req, 'signup', 20, 10 * 60 * 1000)) return fail(res, 429, 'Too many attempts. Try again later.');
  const body = await readJsonBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const emailIssue = emailProblem(email);
  if (emailIssue) return fail(res, 400, emailIssue);
  const pwIssue = passwordProblem(body.password);
  if (pwIssue) return fail(res, 400, pwIssue);
  if (db.users.some((u) => u.email === email)) return fail(res, 409, 'An account with that email already exists.');

  const displayName = String(body.displayName || '').trim().slice(0, 40) || email.split('@')[0];
  const isFirstAccount = db.users.length === 0;
  const user = {
    id: id('usr'),
    email,
    passwordHash: hashPassword(body.password),
    displayName,
    role: isFirstAccount ? 'admin' : 'creator',
    createdAt: nowIso(),
  };
  db.users.push(user);
  startSession(req, res, user);
  sendJson(res, 201, {
    user: publicUser(user),
    firstAccount: isFirstAccount,
    notice: isFirstAccount
      ? 'This is the first account, so it was given the administrator role. Later accounts are creators.'
      : undefined,
  });
});

route('POST', '/api/auth/login', async (req, res) => {
  if (rateLimited(req, 'login', 20, 10 * 60 * 1000)) return fail(res, 429, 'Too many attempts. Try again later.');
  const body = await readJsonBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email === email);
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return fail(res, 401, 'Email or password is incorrect.');
  }
  startSession(req, res, user);
  sendJson(res, 200, { user: publicUser(user) });
});

route('POST', '/api/auth/logout', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    db.sessions = db.sessions.filter((s) => s.token !== token);
    saveDb();
  }
  res.setHeader('Set-Cookie', clearCookie());
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/auth/me', async (req, res) => {
  const user = currentUser(req);
  sendJson(res, 200, { user: publicUser(user) });
});

/* ------------------------------------------------------------------ status */

route('GET', '/api/status', async (req, res) => {
  sendJson(res, 200, {
    mode: 'local',
    data: {
      driver: 'json-file',
      path: dataDir(),
      persistent: false,
      note: 'Stored inside this container. Data resets when the app is redeployed; connect Supabase for permanent storage.',
    },
    supabase: {
      configured: supabaseConfigured,
      detectedUrl: SUPABASE.url || null,
      schemaFile: 'supabase/schema.sql',
      requiredEnv: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    },
    payments: {
      configured: false,
      note: 'No payment provider is connected. Revenue appears only when an administrator records a payment that actually happened.',
    },
    live: {
      provider: LIVE_PROVIDER || null,
      configured: Boolean(LIVE_PROVIDER),
      note: 'Livestreaming needs a video provider. Sessions and the go-live workflow are prepared.',
    },
    limits: {
      maxUploadMb: Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)),
      minWithdrawalUsdt: formatUsdt(MIN_WITHDRAWAL_MICRO),
      creatorShareBps: CREATOR_SHARE_BPS,
      platformShareBps: PLATFORM_SHARE_BPS,
      sessionSecretFromEnv: SESSION_SECRET_PRESENT,
    },
  });
});

route('GET', '/api/stats/public', async (req, res) => {
  const published = db.videos.filter((v) => v.status === 'published');
  const creatorIds = new Set(published.map((v) => v.userId));
  sendJson(res, 200, {
    videos: published.length,
    creators: creatorIds.size,
    views: db.views.length,
    likes: db.likes.length,
  });
});

/* ------------------------------------------------------------------ videos */

route('GET', '/api/videos', async (req, res, ctx) => {
  const q = String(ctx.query.get('q') || '').trim().toLowerCase();
  const limit = Math.min(60, Math.max(1, Number(ctx.query.get('limit')) || 24));
  const counts = countsByVideo();
  let items = db.videos.filter((v) => v.status === 'published');
  if (q) {
    items = items.filter(
      (v) => v.title.toLowerCase().includes(q) || (v.description || '').toLowerCase().includes(q),
    );
  }
  items = items
    .slice()
    .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt))
    .slice(0, limit)
    .map((v) => videoSummary(v, counts));
  sendJson(res, 200, { videos: items });
});

route('GET', '/api/videos/:videoId', async (req, res, ctx) => {
  const user = currentUser(req);
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video) return fail(res, 404, 'Video not found.');
  if (!canWatch(video, user)) return fail(res, 404, 'Video not found.');
  const counts = countsByVideo();
  const liked = user ? db.likes.some((l) => l.videoId === video.id && l.userId === user.id) : false;
  const comments = db.comments
    .filter((c) => c.videoId === video.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-100)
    .map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: (db.users.find((u) => u.id === c.userId) || {}).displayName || 'Member',
    }));
  sendJson(res, 200, {
    video: videoSummary(video, counts),
    liked,
    comments,
    owner: user ? user.id === video.userId : false,
    streamUrl: `/api/videos/${video.id}/file`,
  });
});

route('POST', '/api/videos', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const title = String(body.title || '').trim().slice(0, 120);
  if (title.length < 3) return fail(res, 400, 'Give your video a title of at least 3 characters.');
  const video = {
    id: id('vid'),
    userId: user.id,
    title,
    description: String(body.description || '').trim().slice(0, 2000),
    status: 'draft',
    createdAt: nowIso(),
    publishedAt: null,
    mime: null,
    sizeBytes: 0,
    thumbMime: null,
    durationSec: Number(body.durationSec) || null,
  };
  db.videos.push(video);
  saveDb();
  sendJson(res, 201, {
    video: videoSummary(video),
    upload: {
      method: 'PUT',
      url: `/api/videos/${video.id}/file`,
      maxBytes: MAX_UPLOAD_BYTES,
      maxMb: Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)),
    },
  });
});

route('POST', '/api/videos/:videoId/publish', async (req, res, ctx) => {
  const user = requireUser(req, res);
  if (!user) return;
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video) return fail(res, 404, 'Video not found.');
  if (video.userId !== user.id && user.role !== 'admin') return fail(res, 403, 'You can only publish your own videos.');
  if (!video.sizeBytes) return fail(res, 400, 'Upload the video file before publishing.');
  video.status = 'published';
  video.publishedAt = video.publishedAt || nowIso();
  saveDb();
  sendJson(res, 200, { video: videoSummary(video) });
});

route('DELETE', '/api/videos/:videoId', async (req, res, ctx) => {
  const user = requireUser(req, res);
  if (!user) return;
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video) return fail(res, 404, 'Video not found.');
  if (video.userId !== user.id && user.role !== 'admin') return fail(res, 403, 'You can only delete your own videos.');
  removeStoredFile(video.id);
  removeStoredFile(`${video.id}.thumb`);
  db.videos = db.videos.filter((v) => v.id !== video.id);
  db.views = db.views.filter((v) => v.videoId !== video.id);
  db.likes = db.likes.filter((l) => l.videoId !== video.id);
  db.comments = db.comments.filter((c) => c.videoId !== video.id);
  saveDb();
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/videos/:videoId/thumbnail', async (req, res, ctx) => {
  const user = requireUser(req, res);
  if (!user) return;
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video) return fail(res, 404, 'Video not found.');
  if (video.userId !== user.id && user.role !== 'admin') return fail(res, 403, 'Not your video.');
  const body = await readJsonBody(req, 2 * 1024 * 1024);
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
  if (!match) return fail(res, 400, 'Send a PNG, JPEG or WebP data URL.');
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.length > MAX_THUMB_BYTES) return fail(res, 413, 'Thumbnail is too large.');
  fs.writeFileSync(path.join(UPLOAD_DIR, `${video.id}.thumb`), buffer);
  video.thumbMime = match[1];
  saveDb();
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/videos/:videoId/thumbnail', async (req, res, ctx) => {
  const user = currentUser(req);
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video || !video.thumbMime || !canWatch(video, user)) return fail(res, 404, 'No thumbnail.');
  const file = path.join(UPLOAD_DIR, `${video.id}.thumb`);
  if (!fs.existsSync(file)) return fail(res, 404, 'No thumbnail.');
  res.writeHead(200, { 'Content-Type': video.thumbMime, 'Cache-Control': 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
});

route('POST', '/api/videos/:videoId/view', async (req, res, ctx) => {
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video || video.status !== 'published') return fail(res, 404, 'Video not found.');
  if (rateLimited(req, 'view', 240, 60 * 1000)) return fail(res, 429, 'Too many requests.');
  const key = viewerKey({
    ip: req.socket.remoteAddress || '',
    userAgent: String(req.headers['user-agent'] || ''),
    videoId: video.id,
  });
  const recent = db.views.find(
    (v) => v.videoId === video.id && v.viewerKey === key && Date.now() - new Date(v.createdAt).getTime() < VIEW_DEDUPE_MS,
  );
  if (!recent) {
    db.views.push({ id: id('vw'), videoId: video.id, viewerKey: key, createdAt: nowIso() });
    saveDb();
  }
  sendJson(res, 200, { views: db.views.filter((v) => v.videoId === video.id).length, counted: !recent });
});

route('POST', '/api/videos/:videoId/like', async (req, res, ctx) => {
  const user = requireUser(req, res);
  if (!user) return;
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video || !canWatch(video, user)) return fail(res, 404, 'Video not found.');
  if (!db.likes.some((l) => l.videoId === video.id && l.userId === user.id)) {
    db.likes.push({ videoId: video.id, userId: user.id, createdAt: nowIso() });
    saveDb();
  }
  sendJson(res, 200, { likes: db.likes.filter((l) => l.videoId === video.id).length, liked: true });
});

route('DELETE', '/api/videos/:videoId/like', async (req, res, ctx) => {
  const user = requireUser(req, res);
  if (!user) return;
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video) return fail(res, 404, 'Video not found.');
  db.likes = db.likes.filter((l) => !(l.videoId === video.id && l.userId === user.id));
  saveDb();
  sendJson(res, 200, { likes: db.likes.filter((l) => l.videoId === video.id).length, liked: false });
});

route('POST', '/api/videos/:videoId/comments', async (req, res, ctx) => {
  const user = requireUser(req, res);
  if (!user) return;
  const video = db.videos.find((v) => v.id === ctx.params.videoId);
  if (!video || !canWatch(video, user)) return fail(res, 404, 'Video not found.');
  const body = await readJsonBody(req);
  const text = String(body.body || '').trim().slice(0, 1000);
  if (!text) return fail(res, 400, 'Write a comment first.');
  const comment = { id: id('cmt'), videoId: video.id, userId: user.id, body: text, createdAt: nowIso() };
  db.comments.push(comment);
  saveDb();
  sendJson(res, 201, { comment: { ...comment, author: user.displayName } });
});

/* ---------------------------------------------------------- creator studio */

route('GET', '/api/studio/summary', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const counts = countsByVideo();
  const mine = db.videos.filter((v) => v.userId === user.id);
  const videoIds = new Set(mine.map((v) => v.id));
  const myViews = db.views.filter((v) => videoIds.has(v.videoId));

  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ date, views: myViews.filter((v) => v.createdAt.slice(0, 10) === date).length });
  }

  sendJson(res, 200, {
    totals: {
      videos: mine.length,
      published: mine.filter((v) => v.status === 'published').length,
      drafts: mine.filter((v) => v.status === 'draft').length,
      views: myViews.length,
      likes: db.likes.filter((l) => videoIds.has(l.videoId)).length,
      comments: db.comments.filter((c) => videoIds.has(c.videoId)).length,
    },
    dailyViews: days,
    videos: mine
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((v) => videoSummary(v, counts)),
  });
});

/* --------------------------------------------------------------- earnings */

route('GET', '/api/earnings/summary', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { totals, withdrawals, availableMicro } = earningsFor(user);
  const ledger = creatorRevenue(user.id)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((r) => {
      const split = splitRevenue(r.amountMicro);
      return {
        id: r.id,
        source: r.source,
        note: r.note || '',
        videoId: r.videoId || null,
        createdAt: r.createdAt,
        grossUsdt: formatUsdt(split.totalMicro),
        creatorUsdt: formatUsdt(split.creatorMicro),
        platformUsdt: formatUsdt(split.platformMicro),
      };
    });
  sendJson(res, 200, {
    payments: {
      active: false,
      note: 'No payment provider is connected. These figures come only from payments an administrator has recorded.',
    },
    shares: { creatorBps: CREATOR_SHARE_BPS, platformBps: PLATFORM_SHARE_BPS },
    totals: {
      grossUsdt: formatUsdt(totals.grossMicro),
      creatorUsdt: formatUsdt(totals.creatorMicro),
      platformUsdt: formatUsdt(totals.platformMicro),
      availableUsdt: formatUsdt(availableMicro),
    },
    ledger,
    withdrawals: withdrawals
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((w) => ({
        id: w.id,
        amountUsdt: formatUsdt(w.amountMicro),
        address: w.address,
        status: w.status,
        txHash: w.txHash || null,
        adminNote: w.adminNote || '',
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
    minimumWithdrawalUsdt: formatUsdt(MIN_WITHDRAWAL_MICRO),
  });
});

/* ------------------------------------------------------------ withdrawals */

route('GET', '/api/withdrawals', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const list = db.withdrawals
    .filter((w) => w.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sendJson(res, 200, { withdrawals: list, minimumWithdrawalUsdt: formatUsdt(MIN_WITHDRAWAL_MICRO) });
});

route('POST', '/api/withdrawals', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (rateLimited(req, 'withdraw', 10, 60 * 60 * 1000)) return fail(res, 429, 'Too many requests. Try again later.');
  const body = await readJsonBody(req);
  const amountMicro = parseUsdt(body.amount);
  const address = String(body.address || '').trim();
  const { totals, availableMicro } = earningsFor(user);
  const check = validateWithdrawal({ amountMicro, address, availableMicro });
  if (!check.ok) return fail(res, 400, check.error, { availableUsdt: formatUsdt(availableMicro) });

  const request = {
    id: id('wd'),
    userId: user.id,
    amountMicro,
    address,
    network: 'BEP20',
    status: 'pending',
    txHash: null,
    adminNote: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.withdrawals.push(request);
  saveDb();
  sendJson(res, 201, {
    withdrawal: {
      id: request.id,
      amountUsdt: formatUsdt(request.amountMicro),
      address: request.address,
      status: request.status,
      createdAt: request.createdAt,
    },
    availableUsdt: formatUsdt(availableBalance(totals.creatorMicro, db.withdrawals.filter((w) => w.userId === user.id))),
    note: 'Request recorded. No transfer has been sent yet — an administrator must approve and settle it.',
  });
});

/* ------------------------------------------------------------------ admin */

route('GET', '/api/admin/overview', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const totals = sumRevenue(db.revenue);
  const pending = db.withdrawals.filter((w) => w.status === 'pending');
  sendJson(res, 200, {
    counts: {
      users: db.users.length,
      creators: db.users.filter((u) => u.role === 'creator').length,
      admins: db.users.filter((u) => u.role === 'admin').length,
      videos: db.videos.length,
      published: db.videos.filter((v) => v.status === 'published').length,
      views: db.views.length,
      comments: db.comments.length,
    },
    revenue: {
      grossUsdt: formatUsdt(totals.grossMicro),
      creatorUsdt: formatUsdt(totals.creatorMicro),
      platformUsdt: formatUsdt(totals.platformMicro),
      rows: db.revenue.length,
    },
    withdrawals: {
      pending: pending.length,
      pendingUsdt: formatUsdt(pending.reduce((s, w) => s + w.amountMicro, 0)),
      paid: db.withdrawals.filter((w) => w.status === 'paid').length,
    },
    payments: { active: false, note: 'No payment provider connected. Revenue is recorded manually by an administrator.' },
  });
});

route('GET', '/api/admin/users', async (req, res, ctx) => {
  if (!requireAdmin(req, res)) return;
  const q = String(ctx.query.get('q') || '').trim().toLowerCase();
  const counts = countsByVideo();
  const users = db.users
    .filter((u) => !q || u.email.includes(q) || u.displayName.toLowerCase().includes(q))
    .map((u) => {
      const videos = db.videos.filter((v) => v.userId === u.id);
      const ids = new Set(videos.map((v) => v.id));
      const totals = sumRevenue(creatorRevenue(u.id));
      return {
        ...publicUser(u),
        videos: videos.length,
        views: db.views.filter((v) => ids.has(v.videoId)).length,
        earningsUsdt: formatUsdt(totals.creatorMicro),
        availableUsdt: formatUsdt(earningsFor(u).availableMicro),
      };
    });
  sendJson(res, 200, { users });
});

route('PATCH', '/api/admin/users/:userId', async (req, res, ctx) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJsonBody(req);
  const role = String(body.role || '');
  if (!['viewer', 'creator', 'admin'].includes(role)) return fail(res, 400, 'Role must be viewer, creator or admin.');
  const target = db.users.find((u) => u.id === ctx.params.userId);
  if (!target) return fail(res, 404, 'User not found.');
  if (target.id === admin.id && role !== 'admin') {
    return fail(res, 400, 'You cannot remove your own administrator access.');
  }
  target.role = role;
  saveDb();
  sendJson(res, 200, { user: publicUser(target) });
});

route('GET', '/api/admin/withdrawals', async (req, res, ctx) => {
  if (!requireAdmin(req, res)) return;
  const status = String(ctx.query.get('status') || '').trim();
  const rows = db.withdrawals
    .filter((w) => !status || w.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((w) => {
      const owner = db.users.find((u) => u.id === w.userId);
      return {
        id: w.id,
        amountUsdt: formatUsdt(w.amountMicro),
        address: w.address,
        network: w.network,
        status: w.status,
        txHash: w.txHash,
        adminNote: w.adminNote,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        user: owner ? { id: owner.id, email: owner.email, displayName: owner.displayName } : null,
      };
    });
  sendJson(res, 200, { withdrawals: rows });
});

route('PATCH', '/api/admin/withdrawals/:withdrawalId', async (req, res, ctx) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJsonBody(req);
  const action = String(body.action || '');
  const request = db.withdrawals.find((w) => w.id === ctx.params.withdrawalId);
  if (!request) return fail(res, 404, 'Withdrawal request not found.');

  if (action === 'approve') {
    if (request.status !== 'pending') return fail(res, 409, 'Only pending requests can be approved.');
    request.status = 'approved';
  } else if (action === 'reject') {
    if (['paid', 'rejected'].includes(request.status)) return fail(res, 409, 'This request is already closed.');
    request.status = 'rejected';
    request.adminNote = String(body.note || '').slice(0, 500);
  } else if (action === 'paid') {
    if (request.status === 'paid') return fail(res, 409, 'This request is already marked paid.');
    if (request.status === 'rejected') return fail(res, 409, 'Rejected requests cannot be marked paid.');
    const txHash = String(body.txHash || '').trim();
    if (!TX_HASH_RE.test(txHash)) {
      return fail(res, 400, 'Enter the BEP20 transaction hash (0x followed by 64 hex characters) after sending the transfer.');
    }
    request.status = 'paid';
    request.txHash = txHash;
  } else {
    return fail(res, 400, 'Action must be approve, reject or paid.');
  }

  request.adminNote = String(body.note || request.adminNote || '').slice(0, 500);
  request.updatedAt = nowIso();
  request.handledBy = admin.id;
  saveDb();
  sendJson(res, 200, {
    withdrawal: {
      id: request.id,
      status: request.status,
      txHash: request.txHash,
      adminNote: request.adminNote,
      updatedAt: request.updatedAt,
    },
  });
});

route('POST', '/api/admin/revenue', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJsonBody(req);
  const creator = db.users.find((u) => u.id === String(body.creatorId || ''));
  if (!creator) return fail(res, 404, 'Choose a creator for this revenue.');
  const amountMicro = parseUsdt(body.amount);
  if (!Number.isSafeInteger(amountMicro) || amountMicro <= 0) return fail(res, 400, 'Enter a valid USDT amount.');
  const source = String(body.source || '').trim().slice(0, 60);
  if (!source) return fail(res, 400, 'Describe where this payment came from.');
  const videoId = body.videoId ? String(body.videoId) : null;
  if (videoId && !db.videos.some((v) => v.id === videoId && v.userId === creator.id)) {
    return fail(res, 400, 'That video does not belong to the selected creator.');
  }
  const row = {
    id: id('rev'),
    creatorId: creator.id,
    videoId,
    amountMicro,
    source,
    note: String(body.note || '').slice(0, 500),
    recordedBy: admin.id,
    createdAt: nowIso(),
  };
  db.revenue.push(row);
  saveDb();
  const split = splitRevenue(amountMicro);
  sendJson(res, 201, {
    revenue: {
      id: row.id,
      grossUsdt: formatUsdt(split.totalMicro),
      creatorUsdt: formatUsdt(split.creatorMicro),
      platformUsdt: formatUsdt(split.platformMicro),
    },
    note: 'Recorded only because a real payment was received. This does not charge anyone.',
  });
});

route('GET', '/api/admin/videos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const counts = countsByVideo();
  const videos = db.videos
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((v) => videoSummary(v, counts));
  sendJson(res, 200, { videos });
});

/* ------------------------------------------------------------------- live */

route('GET', '/api/live/config', async (req, res) => {
  sendJson(res, 200, {
    provider: LIVE_PROVIDER || null,
    configured: Boolean(LIVE_PROVIDER),
    ingestUrl: process.env.LIVE_INGEST_URL || null,
    playbackUrlTemplate: process.env.LIVE_PLAYBACK_URL_TEMPLATE || null,
    note: LIVE_PROVIDER
      ? 'A livestream provider is configured.'
      : 'No livestream provider is configured yet, so broadcasting is disabled. Sessions and the go-live workflow are ready to connect.',
  });
});

route('GET', '/api/live/sessions', async (req, res) => {
  const user = currentUser(req);
  const sessions = db.live
    .filter((s) => s.status === 'live' || s.status === 'scheduled' || (user && s.userId === user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      createdAt: s.createdAt,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      owner: (db.users.find((u) => u.id === s.userId) || {}).displayName || 'Unknown',
      mine: Boolean(user && s.userId === user.id),
      playbackUrl: s.playbackUrl || null,
    }));
  sendJson(res, 200, { sessions, providerConfigured: Boolean(LIVE_PROVIDER) });
});

route('POST', '/api/live/sessions', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const title = String(body.title || '').trim().slice(0, 120);
  if (title.length < 3) return fail(res, 400, 'Give the stream a title of at least 3 characters.');
  const session = {
    id: id('live'),
    userId: user.id,
    title,
    status: 'scheduled',
    createdAt: nowIso(),
    startedAt: null,
    endedAt: null,
    playbackUrl: null,
  };
  db.live.push(session);
  saveDb();
  sendJson(res, 201, { session });
});

route('PATCH', '/api/live/sessions/:sessionId', async (req, res, ctx) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const session = db.live.find((s) => s.id === ctx.params.sessionId);
  if (!session) return fail(res, 404, 'Stream session not found.');
  if (session.userId !== user.id && user.role !== 'admin') return fail(res, 403, 'Not your stream.');
  const status = String(body.status || '');
  if (status === 'live') {
    if (!LIVE_PROVIDER) {
      return fail(res, 409, 'No livestream provider is connected, so the stream cannot go live yet.', {
        providerConfigured: false,
      });
    }
    session.status = 'live';
    session.startedAt = nowIso();
  } else if (status === 'ended') {
    session.status = 'ended';
    session.endedAt = nowIso();
  } else {
    return fail(res, 400, 'Status must be live or ended.');
  }
  saveDb();
  sendJson(res, 200, { session });
});

/* ------------------------------------------------------------ file storage */

function removeStoredFile(name) {
  const file = path.join(UPLOAD_DIR, name);
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}

async function handleUpload(req, res, video) {
  const length = Number(req.headers['content-length'] || 0);
  if (!length) return fail(res, 411, 'Send the file with a Content-Length header.');
  if (length > MAX_UPLOAD_BYTES) {
    return fail(res, 413, `File is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`);
  }
  const mime = String(req.headers['content-type'] || 'video/mp4').split(';')[0];
  if (!mime.startsWith('video/')) return fail(res, 415, 'Only video files can be uploaded here.');

  const target = path.join(UPLOAD_DIR, video.id);
  const tmp = `${target}.part`;
  const stream = fs.createWriteStream(tmp);
  let received = 0;

  try {
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) {
          req.destroy();
          reject(new Error('TOO_LARGE'));
        }
      });
      req.on('error', reject);
      stream.on('error', reject);
      stream.on('finish', resolve);
      req.pipe(stream);
    });
  } catch {
    stream.destroy();
    removeStoredFile(`${video.id}.part`);
    return fail(res, 413, 'Upload was larger than the allowed size.');
  }

  fs.renameSync(tmp, target);
  video.sizeBytes = received;
  video.mime = mime;
  video.uploadedAt = nowIso();
  saveDb();
  sendJson(res, 200, { ok: true, sizeBytes: received, mime });
}

function serveVideoFile(req, res, video) {
  const file = path.join(UPLOAD_DIR, video.id);
  if (!fs.existsSync(file)) return fail(res, 404, 'Video file is missing.');
  const stat = fs.statSync(file);
  const type = video.mime || 'video/mp4';
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300',
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }
  res.writeHead(206, {
    'Content-Type': type,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=300',
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}

/* ---------------------------------------------------------------- static */

const PAGES = {
  '/': 'index.html',
  '/home': 'index.html',
  '/feed': 'feed.html',
  '/watch': 'watch.html',
  '/upload': 'upload.html',
  '/studio': 'studio.html',
  '/earnings': 'earnings.html',
  '/admin': 'admin.html',
  '/live': 'live.html',
  '/login': 'login.html',
  '/signup': 'signup.html',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = null;
  if (PAGES[pathname]) filePath = path.join(ROOT, PAGES[pathname]);
  else if (pathname.startsWith('/assets/')) filePath = path.join(ROOT, pathname);
  else if (/^\/[a-z0-9-]+\.html$/.test(pathname)) filePath = path.join(ROOT, pathname);

  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== path.join(ROOT, 'index.html')) return false;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return false;

  const ext = path.extname(resolved).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const body = fs.readFileSync(resolved);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=600',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(body);
  return true;
}

/* ----------------------------------------------------------------- server */

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'",
    );

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin) {
          try {
            if (new URL(origin).host !== req.headers.host) return fail(res, 403, 'Cross-origin request refused.');
          } catch {
            return fail(res, 403, 'Cross-origin request refused.');
          }
        }
      }

      // Raw video upload (streamed, never buffered in memory).
      const uploadMatch = /^\/api\/videos\/([^/]+)\/file$/.exec(pathname);
      if (uploadMatch) {
        if (req.method === 'PUT') {
          const user = requireUser(req, res);
          if (!user) return;
          const video = db.videos.find((v) => v.id === uploadMatch[1]);
          if (!video) return fail(res, 404, 'Video not found.');
          if (video.userId !== user.id && user.role !== 'admin') return fail(res, 403, 'Not your video.');
          return await handleUpload(req, res, video);
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          const user = currentUser(req);
          const video = db.videos.find((v) => v.id === uploadMatch[1]);
          if (!video || !canWatch(video, user)) return fail(res, 404, 'Video not found.');
          return serveVideoFile(req, res, video);
        }
      }

      const matched = matchRoute(req.method, pathname);
      if (matched) {
        const body = { params: matched.params, query: url.searchParams };
        return await matched.handler(req, res, body);
      }

      if (pathname.startsWith('/api/')) return fail(res, 404, 'Unknown endpoint.');

      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, pathname)) return;

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (error) {
      if (error && error.message === 'INVALID_JSON') return fail(res, 400, 'Invalid JSON body.');
      if (error && error.message === 'PAYLOAD_TOO_LARGE') return fail(res, 413, 'Request body is too large.');
      console.error('[josh] request failed:', error);
      if (!res.headersSent) fail(res, 500, 'Something went wrong on the server.');
      else res.end();
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`[josh] listening on http://${HOST}:${PORT}`);
    console.log(`[josh] data directory: ${dataDir()}`);
    console.log(`[josh] supabase: ${supabaseConfigured ? 'credentials detected' : 'not connected (local store in use)'}`);
  });
}
