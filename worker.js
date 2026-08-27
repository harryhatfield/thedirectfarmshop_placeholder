// Standalone Cloudflare Worker — POST /subscribe
//
// The static site is hosted on GitHub Pages, which can't run server code,
// so this API lives separately on Cloudflare Workers and is called
// cross-origin from index.html. It verifies a Turnstile CAPTCHA token, adds
// the signup to a Resend Audience (this is the waitlist itself — no
// separate database), and sends a confirmation email via Resend. Shoppers
// and farmers go into separate audiences so each group can be followed up
// with separately.
//
// Required environment variables (set via `wrangler secret put` or the
// Cloudflare dashboard → Workers & Pages → this worker → Settings → Variables):
//   TURNSTILE_SECRET_KEY        — secret key for the Turnstile widget
//   RESEND_API_KEY              — Resend API key
//   RESEND_AUDIENCE_ID_SHOPPERS — Resend Audience ID for shopper signups
//   RESEND_AUDIENCE_ID_FARMERS  — Resend Audience ID for farmer signups
//   RESEND_FROM                 — verified sender, e.g. "TheDirectFarmShop <hello@thedirectfarmshop.com>"
// Optional:
//   NOTIFY_EMAIL                — internal address to notify on each new signup

// Origins allowed to call this API. Add your production domain(s) here.
const ALLOWED_ORIGINS = [
  "https://thedirectfarmshop.com",
  "https://www.thedirectfarmshop.com",
  "https://harryhatfield.github.io",
  "http://localhost:8000",
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/subscribe") {
      return json({ ok: false, error: "Not found." }, 404, cors);
    }

    return handleSubscribe(request, env, cors);
  },
};

async function handleSubscribe(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400, cors);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const postcode = typeof body.postcode === "string" ? body.postcode.trim().slice(0, 16) : "";
  const role = body.role === "farmer" ? "farmer" : "shopper";
  const hpNote = typeof body.hp_note === "string" ? body.hp_note.trim() : "";
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  // Honeypot: real visitors never fill this in.
  if (hpNote) {
    return json({ ok: true }, 200, cors);
  }

  if (!isValidEmail(email)) {
    return json({ ok: false, error: "That email doesn't look right." }, 400, cors);
  }

  if (!turnstileToken) {
    return json({ ok: false, error: "Captcha check missing — refresh and try again." }, 400, cors);
  }

  const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: turnstileToken,
      remoteip: request.headers.get("CF-Connecting-IP") || "",
    }),
  }).then((r) => r.json());

  if (!verify.success) {
    return json({ ok: false, error: "Captcha check failed — try again." }, 400, cors);
  }

  // Add to the Resend Audience — this is the waitlist. Shoppers and farmers
  // are kept in separate audiences so each can be followed up with differently.
  const audienceId = role === "farmer" ? env.RESEND_AUDIENCE_ID_FARMERS : env.RESEND_AUDIENCE_ID_SHOPPERS;
  const audienceRes = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      unsubscribed: false,
      ...(postcode ? { first_name: postcode } : {}),
    }),
  });

  if (!audienceRes.ok) {
    const detail = await audienceRes.text().catch(() => "");
    console.error("Resend audience add failed", audienceRes.status, detail);
    return json({ ok: false, error: "That didn't go through — try again in a moment." }, 502, cors);
  }

  // Confirmation email — best-effort, doesn't block success.
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: email,
      subject: role === "farmer" ? "You're on the list — we'll be in touch" : "You're on the list",
      html: confirmationHtml(postcode, role),
    }),
  }).catch((err) => console.error("Confirmation email failed", err));

  if (env.NOTIFY_EMAIL) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: env.NOTIFY_EMAIL,
        subject: `New ${role} signup`,
        html: `<p>${escapeHtml(email)} — ${role} — ${escapeHtml(postcode || "no postcode given")}</p>`,
      }),
    }).catch((err) => console.error("Notify email failed", err));
  }

  return json({ ok: true }, 200, cors);
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length > 0 &&
    email.length < 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function confirmationHtml(postcode, role) {
  const near = postcode ? ` near <strong>${escapeHtml(postcode)}</strong>` : "";
  const body =
    role === "farmer"
      ? `<p>Thanks for your interest in selling on TheDirectFarmShop${near}. We're onboarding farms ahead of launch — someone from the team will email you directly about listing your produce.</p>`
      : `<p>Thanks for putting your name down for TheDirectFarmShop${near}. We'll email you the moment your patch goes live — real stock, straight from local farms.</p>`;
  return `
    <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; color:#23261E;">
      <h1 style="font-size:20px;">You're on the list.</h1>
      ${body}
      <p>Talk soon,<br>TheDirectFarmShop</p>
    </div>
  `;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
