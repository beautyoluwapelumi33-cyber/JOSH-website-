import { feed, watch, upload, login, signup } from './views.js';
import { studio, earnings } from './studio.js';
import { admin, live } from './admin.js';

const pages = { feed, watch, upload, login, signup, studio, earnings, admin, live };
const page = document.body.dataset.page;
const run = pages[page];

if (run) {
  run().catch((error) => {
    console.error(`[josh] page "${page}" failed to start`, error);
    const root =
      document.getElementById(`${page}-root`) ||
      document.querySelector('main');
    if (root) {
      const box = document.createElement('div');
      box.className = 'notice error';
      box.textContent = `Something went wrong loading this page: ${error.message}`;
      root.prepend(box);
    }
  });
}
