/**
 * JOSH — sign in / create account.
 * One module for both pages (body[data-mode]); on success it re-reads the
 * session from the server instead of trusting a redirect.
 */
import { api, esc, qs, icon } from './core.js';

const mode = document.body.dataset.mode === 'signup' ? 'signup' : 'login';
const form = document.getElementById('auth-form');
const errorBox = document.getElementById('error');
const submit = document.getElementById('submit');
const next = qs('next');

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function safeNext() {
  if (!next) return '/';
  try {
    const url = new URL(next, location.origin);
    if (url.origin !== location.origin) return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.add('hidden');
  submit.disabled = true;
  submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';

  const payload = {
    email: form.email.value.trim(),
    password: form.password.value,
  };
  if (mode === 'signup') payload.displayName = form.displayName.value.trim();

  if (!payload.email || !payload.password) {
    showError('Enter your email and password.');
    submit.disabled = false;
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    return;
  }
  if (mode === 'signup' && !payload.displayName) {
    showError('Choose a channel name.');
    submit.disabled = false;
    submit.textContent = 'Create account';
    return;
  }

  try {
    await api(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, { method: 'POST', body: payload });
    const me = await api('/api/auth/me').catch(() => null);
    const user = me && (me.user || me.me);
    if (!user) throw new Error('The session could not be confirmed. Try signing in again.');
    location.replace(safeNext());
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
    submit.disabled = false;
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  }
});

/* If already signed in, do not show the form. */
(async function already() {
  try {
    const me = await api('/api/auth/me');
    if (me && (me.user || me.me)) location.replace(safeNext());
  } catch {
    /* not signed in — stay on the form */
  }
})();
