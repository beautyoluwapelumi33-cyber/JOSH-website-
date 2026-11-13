/* Landing page bridge: real platform counters + session-aware navigation. */

import { api, loadSession, mountHeader, el } from './api.js';

function formatCount(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

async function main() {
  await loadSession();
  mountHeader('');

  const note = el('stats-note');
  const nodes = document.querySelectorAll('[data-stat]');

  try {
    const stats = await api('/api/stats/public');
    nodes.forEach((node) => {
      const key = node.dataset.stat;
      const value = Number(stats[key] ?? 0);
      node.textContent = key === 'videos' || key === 'creators' ? String(value) : formatCount(value);
    });
    if (note) {
      note.textContent =
        stats.videos === 0
          ? 'No videos published yet — these counters are live, not illustrative.'
          : 'Counted from real playback on this platform.';
    }
  } catch {
    nodes.forEach((node) => {
      node.textContent = '—';
    });
    if (note) note.textContent = 'Counters unavailable right now.';
  }
}

main();
