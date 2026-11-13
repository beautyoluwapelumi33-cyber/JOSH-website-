# JOSH — video platform

The original JOSH site (dark theme, pink branding, hero/About/Solutions/Results/Contact
navigation) is preserved. It is now backed by a real Node server, so the pages show
real accounts, real uploads and real counts instead of placeholders.

## What actually works right now

| Area | Status |
| --- | --- |
| Accounts | Sign up, sign in, sign out, persistent sessions. Passwords are hashed with scrypt (`node:crypto`), never stored in plain text. |
| Roles | The **first** account created becomes the administrator; every later account is a creator. Roles are enforced on the server, not in the browser. |
| Upload | File upload (streamed to disk, size limited), title/description, client-side thumbnail capture, draft → published flow. |
| Feed | Public published-video feed with search, newest first. |
| Player | `/watch/<id>` plays the real uploaded file, records a real view (deduplicated per viewer), likes and comments. |
| Creator Studio | Your videos with their real view/like/comment counts, drafts, publish and delete. |
| Admin | Private dashboard: users and roles, all videos, revenue recording, withdrawal review. Non-admins get `403`. |
| Earnings | 60% creator / 40% platform split computed from revenue rows an administrator has actually recorded. |
| Withdrawals | USDT BEP20 requests, 0.5 USDT minimum, balance checks, admin approve/reject/settle with a transaction hash. |
| Live | Session records, camera/microphone preview, and provider config read from environment variables. |

## Honest limits (by design)

* **No invented numbers.** Earnings, views and stats are derived from stored records only.
  A fresh install shows `0`, not a demo figure.
* **Payments are not active.** `payments.active` is `false` and the UI says so. Money only
  appears after an administrator records an actual payment.
* **No transfer is sent.** A withdrawal request is a request. Approving it records a
  transaction hash that an administrator has to settle by hand — the app never claims a
  payout happened on its own.
* **Live broadcasting needs a provider.** The page shows setup state until an RTMP
  endpoint and stream key are configured; there is no fake "LIVE" badge.
* **Storage is the container disk** until Supabase is connected, so data does not survive
  a redeploy. See below.

## Run locally

```bash
npm install     # no dependencies to install; there are none beyond Node itself
npm start       # http://localhost:3000
npm test        # 27 tests: money math + end-to-end API
```

Node 20+ is required. The server has **no** third-party runtime dependencies.

## Connecting Supabase (stages 1 and 2)

The schema is prepared in [`supabase/schema.sql`](supabase/schema.sql) but is not applied
automatically.

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run the whole of `supabase/schema.sql`. It creates the tables,
   row-level security policies, the `josh-videos` storage bucket and a revenue-split view.
3. Add these in **Settings → Environment variables** (or a local `.env`, see `.env.example`):

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_ANON_KEY=<anon public key>
   SUPABASE_VIDEO_BUCKET=josh-videos
   ```

   Use the anon/public key only — never the `service_role` key in a browser-facing app.
4. Restart. `GET /api/status` reports whether Supabase credentials were detected.

Until that is done, the app runs on its own store (`data/db.json`, atomic writes) and
`/api/status` says so plainly rather than pretending to be connected.

## Revenue model

All money is integer **micro-USDT** (1 USDT = 1,000,000 micro) so a balance comparison
can never be thrown off by floating-point drift.

```
creator  = floor(gross * 6000 / 10000)   // exactly 60%
platform = gross - creator               // remainder, so no micro-unit is lost
```

`available = creator share − (pending + approved + paid withdrawals)`, floored at zero.
Rejecting a request releases its funds automatically. The 0.5 USDT minimum and the
BEP20 address format (`0x` + 40 hex characters) are validated on the server before
anything is written.

## Layout

```
index.html              original landing page, now with real counters + platform nav
feed.html watch.html    public feed and player
upload.html studio.html creator upload and statistics
earnings.html           balances, ledger, USDT BEP20 withdrawal requests
admin.html              private dashboard (role-gated)
live.html               livestream preparation
login.html signup.html  authentication
assets/css/platform.css shared dark/pink design system
assets/js/              api.js, views.js, studio.js, admin.js, app.js, home.js
server/index.js         HTTP server, routes, auth and authorization
server/store.js         persisted store with atomic writes
server/auth.js          scrypt hashing, session tokens, cookie signing
server/earnings.js      split, parsing, withdrawal validation
supabase/schema.sql     prepared database, RLS and storage policies
tests/                  money math + end-to-end API tests
```

## Note on GitHub Pages

The existing `.github/workflows/static.yml` publishes the site as static files. That
cannot run the API, so the platform is served by the Node container (`npm start`,
port 3000). GitHub Pages can still host the marketing page, but sign-in, uploads and
statistics only work on the Node deployment.
