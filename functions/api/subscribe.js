// Cloudflare Pages Function — POST /api/subscribe
// Verifies a Turnstile CAPTCHA token, adds the signup to a Resend Audience
// (this is the waitlist itself — no separate database), and sends a
// confirmation email via Resend. Shoppers and farmers go into separate
// audiences so each group can be followed up with separately.
//
// Required environment variables (set in the Cloudflare Pages project):
//   TURNSTILE_SECRET_KEY        — secret key for the Turnstile widget
//   RESEND_API_KEY              — Resend API key
//   RESEND_AUDIENCE_ID_SHOPPERS — Resend Audience ID for shopper signups
//   RESEND_AUDIENCE_ID_FARMERS  — Resend Audience ID for farmer signups
//   RESEND_FROM                 — verified sender, e.g. "TheDirectFarmShop <hello@thedirectfarmshop.com>"
// Optional:
//   NOTIFY_EMAIL                — internal address to notify on each new signup

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const postcode = typeof body.postcode === "string" ? body.postcode.trim().slice(0, 16) : "";
  const role = body.role === "farmer" ? "farmer" : "shopper";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";

  // Honeypot: real visitors never fill this in.
  if (company) {
    return json({ ok: true });
  }

  if (!isValidEmail(email)) {
    return json({ ok: false, error: "That email doesn't look right." }, 400);
  }

  if (!turnstileToken) {
    return json({ ok: false, error: "Captcha check missing — refresh and try again." }, 400);
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
    return json({ ok: false, error: "Captcha check failed — try again." }, 400);
  }

  // Add to the Resend Audience — this is the waitlist. Shoppers and farmers
  // are kept in separate audiences so each can be followed up with differently.
  const audienceId = role === "farmer" ? env.RESEND_AUDIENCE_ID_FARMERS : env.RESEND_AUDIENCE_ID_SHOPPERS;
  const audienceRes = await fetch(
    `https://api.resend.com/audiences/${audienceId}/contacts`,
    {
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
    }
  );

  if (!audienceRes.ok) {
    const detail = await audienceRes.text().catch(() => "");
    console.error("Resend audience add failed", audienceRes.status, detail);
    return json({ ok: false, error: "That didn't go through — try again in a moment." }, 502);
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

  return json({ ok: true });
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
