/**
 * Email every Firebase Auth account that has an email address.
 *
 * Prerequisites:
 * 1. Service account JSON (same as tools/setAdminClaim.mjs).
 *    Set: FIREBASE_SERVICE_ACCOUNT_JSON=C:\path\to\service-account.json
 * 2. Resend account + verified "from" domain (or Resend sandbox rules).
 *    Set: RESEND_API_KEY=re_xxxxx
 *    Set: MAIL_FROM="Nondies Fantasy <noreply@yourdomain.com>"
 * 3. App URL used in the message body:
 *    Set: APP_URL=https://your-app.vercel.app
 *
 * Preview recipients only (no send):
 *   node tools/sendLeagueAnnouncement.mjs
 *
 * Actually send (requires explicit flag):
 *   set SEND_CONFIRM=yes&& node tools/sendLeagueAnnouncement.mjs
 */

import admin from "firebase-admin";
import { readFileSync } from "node:fs";

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountPath) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT_JSON to your service account JSON file path.");
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const dryRun =
  process.env.DRY_RUN === "1" || process.env.SEND_CONFIRM?.toLowerCase() !== "yes";

const resendKey = process.env.RESEND_API_KEY;
const mailFrom = process.env.MAIL_FROM ?? "Nondies Fantasy League <onboarding@resend.dev>";
const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const subject =
  process.env.MAIL_SUBJECT ?? "Nondies fantasy — pick your starting XI";

const defaultHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
  <p>Hi — it&apos;s time to set your squad for this week.</p>
  <p>Open the league site, sign in, and lock in your <strong>starting XI</strong> (captain, vice-captain, wicketkeeper) before lineup lock.</p>
  <p><a href="${appUrl}" style="color: #b91c1c;">Go to Nondies Fantasy League</a></p>
  <p style="color:#666;font-size:12px;">If you already submitted, you can ignore this.</p>
</body>
</html>
`.trim();

const textBody = `Hi — it's time to set your squad for this week.

Open the league, sign in, and lock in your starting XI before lineup lock:
${appUrl}

If you already submitted, you can ignore this.`;

const htmlBody = process.env.MAIL_HTML?.trim()?.length ? process.env.MAIL_HTML : defaultHtml;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function collectAuthEmails() {
  const emails = new Set();
  let pageToken;
  do {
    const res = await admin.auth().listUsers(1000, pageToken);
    for (const u of res.users) {
      const e = u.email?.trim();
      if (e) emails.add(e);
    }
    pageToken = res.pageToken;
  } while (pageToken);
  return [...emails].sort((a, b) => a.localeCompare(b));
}

async function sendViaResend(to) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom,
      to: [to],
      subject,
      html: htmlBody,
      text: textBody,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Resend ${res.status}: ${t}`);
  }
}

const emails = await collectAuthEmails();
console.log(`Found ${emails.length} unique email(s) in Firebase Auth.\n`);
emails.forEach((e) => console.log(`  ${e}`));

if (dryRun) {
  console.log(`
--- Dry run (no emails sent) ---
To send for real:
  1. Set RESEND_API_KEY, MAIL_FROM (verified sender), APP_URL
  2. Run with: SEND_CONFIRM=yes  (and optional MAIL_SUBJECT / MAIL_HTML)
`);
  process.exit(0);
}

if (!resendKey) {
  console.error("Set RESEND_API_KEY to send email.");
  process.exit(1);
}

console.log(`\nSending from ${mailFrom} …\n`);
let ok = 0;
let fail = 0;
for (const to of emails) {
  try {
    await sendViaResend(to);
    console.log(`OK  ${to}`);
    ok += 1;
  } catch (e) {
    console.error(`ERR ${to} — ${e.message}`);
    fail += 1;
  }
  await sleep(350);
}

console.log(`\nDone. Sent: ${ok}, failed: ${fail}`);
