# TheDirectFarmShop — placeholder / coming soon page

A single static page (`index.html`) plus one Cloudflare Pages Function
(`functions/api/subscribe.js`) that handles the email signup form:
Turnstile verifies the visitor is human, then the email + postcode are
added to a Resend Audience (the waitlist itself — no separate database)
and a confirmation email goes out via Resend.

## Setup

### 1. Cloudflare Turnstile (CAPTCHA)

The widget's site key (`0x4AAAAAAEdqC2ClL0ZxeAH4`) is already wired into
`index.html` — site keys are public by design, safe to commit. Make sure
the widget's allowed domains (in the Cloudflare dashboard → Turnstile →
your widget) include your Pages domain and `localhost` for local dev.

You still need the widget's **Secret key** (shown once at creation, or
re-viewable in the dashboard) — set it as `TURNSTILE_SECRET_KEY` below.
Never put the secret key in code, only in the Pages environment variables.

### 2. Resend

1. Create a [Resend](https://resend.com) account and verify the sending domain
   you'll use for `RESEND_FROM` (e.g. `hello@thedirectfarmshop.com`).
2. Create an **API key**.
3. Create an **Audience** (Resend's contact list feature) — this *is* the
   waitlist. Copy its Audience ID.

### 3. Cloudflare Pages project

1. Push this repo and connect it as a Cloudflare Pages project (framework
   preset: **None**, build command: none, output directory: `/`).
2. In the Pages project → **Settings → Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `TURNSTILE_SECRET_KEY` | Turnstile secret key from step 1 |
   | `RESEND_API_KEY` | Resend API key from step 2 |
   | `RESEND_AUDIENCE_ID` | Resend Audience ID from step 2 |
   | `RESEND_FROM` | e.g. `TheDirectFarmShop <hello@thedirectfarmshop.com>` |
   | `NOTIFY_EMAIL` *(optional)* | an internal address to BCC-style notify on each signup |

   Set these for both **Production** and **Preview** environments.

## Local development

```bash
npm install
npm run dev
```

This runs `wrangler pages dev`, serving `index.html` and the
`/api/subscribe` function together. Create a `.dev.vars` file (git-ignored)
with the same variables as above for local testing:

```
TURNSTILE_SECRET_KEY=...
RESEND_API_KEY=...
RESEND_AUDIENCE_ID=...
RESEND_FROM=...
```

## Deploy

```bash
npm run deploy
```

(Or just push to the connected git branch — Cloudflare Pages redeploys automatically.)
