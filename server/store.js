import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Local data store for the no-Supabase build.
 *
 * This is a real, persisted store: records survive restarts of the process and
 * are written atomically (temp file + rename) so a crash cannot leave a
 * half-written database. It lives on the container filesystem, which on the
 * current hosting plan is ephemeral - connect Supabase for permanent data.
 */

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const SECTIONS = [
  'users',
  'sessions',
  'videos',
  'views',
  'likes',
  'comments',
  'revenue',
  'withdrawals',
  'live',
  'subscriptions',
  'history',
];

let db = null;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function loadDb() {
  if (db) return db;
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') db = parsed;
    } catch {
      db = null;
    }
  }
  if (!db) db = { version: 1, meta: {} };
  for (const section of SECTIONS) {
    if (!Array.isArray(db[section])) db[section] = [];
  }
  if (!db.meta || typeof db.meta !== 'object') db.meta = {};
  return db;
}

export function saveDb() {
  if (!db) return;
  ensureDirs();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

export function dataDir() {
  return DATA_DIR;
}

export function dbFile() {
  return DB_FILE;
}

export function uid(prefix = '') {
  return `${prefix}${randomUUID()}`;
}
