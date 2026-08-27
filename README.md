# TheDirectFarmShop — placeholder / coming soon page

The site is split across two hosts:

- **`index.html`** (+ `favicon.svg`, `CNAME`) — the static coming-soon page,
  served by **GitHub Pages** at thedirectfarmshop.com.
- **`worker.js`** — a standalone **Cloudflare Worker** that handles the
  signup form's API (`POST /subscribe`), called cross-origin from the page.
  GitHub Pages only serves static files, so the backend has to live
  elsewhere — this keeps Turnstile + Resend without needing a different
  static host.

The Worker verifies a Turnstile CAPTCHA token, then adds the signup
(email, postcode, and whether they're a shopper or a farmer) to a Resend
Audience — this *is* the waitlist, no separate database — and sends a
confirmation email via Resend. Shoppers and farmers are kept in separate
audiences so each group can be followed up with differently.

## Setup

### 1. GitHub Pages (the static site)

1. Repo → **Settings → Pages** → Source: **Deploy from a branch** → branch
   `main`, folder `/ (root)`. Custom domain `thedirectfarmshop.com` (the
   `CNAME` file already matches this — GitHub manages that file itself once
   the custom domain is set here, so don't hand-edit it).
2. Add the DNS records GitHub's Pages settings page shows you (an `A`/`ALIAS`
   record for the apex domain, or a `CNAME` record if you're using `www`).

### 2. Cloudflare Turnstile (CAPTCHA)

The widget's site key (`0x4AAAAAAEdqC2ClL0ZxeAH4`) is already wired into
`index.html` — site keys are public by design, safe to commit. Make sure
the widget's allowed domains (Cloudflare dashboard → Turnstile → your
widget) include `thedirectfarmshop.com` and `localhost` for local dev.

You still need the widget's **Secret key** (shown once at creation, or
re-viewable in the dashboard) — set it as `TURNSTILE_SECRET_KEY` below.
Never put the secret key in code, only in the Worker's environment variables.

### 3. Resend

1. Create a [Resend](https://resend.com) account and verify the sending domain
   you'll use for `RESEND_FROM` (e.g. `hello@thedirectfarmshop.com`).
2. Create an **API key**.
3. Create two **Audiences** (Resend's contact list feature) — these *are*
   the waitlist — one for shoppers, one for farmers. Copy each Audience ID.

### 4. Cloudflare Worker (the API)

1. `npm install`
2. Set the secrets (prompts for each value, doesn't echo it back):
   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_AUDIENCE_ID_SHOPPERS
   npx wrangler secret put RESEND_AUDIENCE_ID_FARMERS
   npx wrangler secret put RESEND_FROM
   npx wrangler secret put NOTIFY_EMAIL   # optional
   ```
3. Deploy:
   ```bash
   npm run deploy
   ```
   This prints the Worker's default URL (`https://thedirectfarmshop-api.<your-subdomain>.workers.dev`) — useful for a quick first test.
4. Add a **custom domain** so the API lives on your own domain: Cloudflare
   dashboard → Workers & Pages → this worker → Settings → Domains & Routes
   → **Add Custom Domain** → `api.thedirectfarmshop.com`. This requires
   `thedirectfarmshop.com`'s DNS zone to be on Cloudflare (it adds the DNS
   record itself once you confirm) — it doesn't require the *site* to be
   hosted on Cloudflare, only the DNS.
   `index.html` already points `SUBSCRIBE_API_URL` at
   `https://api.thedirectfarmshop.com/subscribe` — no page change needed
   once the custom domain is live.
5. In `worker.js`, check `ALLOWED_ORIGINS` includes your real domain(s) —
   the Worker only answers signup requests from origins on that list
   (CORS). Update and redeploy if you add `www` or change domains.

## Local development

```bash
npm run dev
```

Runs the Worker locally via `wrangler dev`. Create a `.dev.vars` file
(git-ignored) with the same variables as step 4 for local testing:

```
TURNSTILE_SECRET_KEY=...
RESEND_API_KEY=...
RESEND_AUDIENCE_ID_SHOPPERS=...
RESEND_AUDIENCE_ID_FARMERS=...
RESEND_FROM=...
```

For the static page itself, any local static server works, e.g.
`python3 -m http.server`.

## Deploy

- **Static page**: push to `main` — GitHub Pages redeploys automatically.
- **Worker**: `npm run deploy` (Cloudflare Pages/Workers doesn't auto-deploy
  from this repo unless you wire up a GitHub Action for it separately).
