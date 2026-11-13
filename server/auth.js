import crypto from 'node:crypto';

/**
 * Password hashing with scrypt from node:crypto.
 * Format: scrypt$N$r$p$saltHex$hashHex
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export const SESSION_COOKIE = 'josh_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function passwordProblem(password) {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > 200) return 'Password is too long.';
  return null;
}

export function emailProblem(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value) return 'Email is required.';
  if (value.length > 254) return 'Email is too long.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.';
  return null;
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Stable, non-reversible key used to de-duplicate video views. */
export function viewerKey({ ip, userAgent, videoId, salt = 'josh-views' }) {
  return crypto
    .createHash('sha256')
    .update(`${salt}|${ip}|${userAgent}|${videoId}`)
    .digest('hex')
    .slice(0, 32);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure }) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
