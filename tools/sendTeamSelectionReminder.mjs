/**
 * Email only users who have not fully saved a valid team yet.
 *
 * Prerequisites:
 * 1) Firebase service account JSON path:
 *    FIREBASE_SERVICE_ACCOUNT_JSON=C:\path\to\service-account.json
 * 2) Resend key + verified sender:
 *    RESEND_API_KEY=re_xxxxx
 *    MAIL_FROM="Nondies Fantasy <noreply@yourdomain.com>"
 * 3) App URL:
 *    APP_URL=https://your-app.vercel.app
 *
 * Dry-run (recommended first):
 *   node tools/sendTeamSelectionReminder.mjs
 *
 * Send for real:
 *   set SEND_CONFIRM=yes&& node tools/sendTeamSelectionReminder.mjs
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

const db = admin.firestore();
const dryRun =
  process.env.DRY_RUN === "1" || process.env.SEND_CONFIRM?.toLowerCase() !== "yes";

const resendKey = process.env.RESEND_API_KEY;
const mailFrom = process.env.MAIL_FROM ?? "Nondies Fantasy League <onboarding@resend.dev>";
const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const squadSize = Number(process.env.SQUAD_SIZE ?? 7);

const subject =
  process.env.MAIL_SUBJECT ?? "Reminder: pick your Nondies fantasy team";

const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111;">
  <p>Quick reminder from Nondies Fantasy League 👋</p>
  <p>You still need to complete your team selection for this week.</p>
  <p>Please open the app and save your team before the lock deadline.</p>
  <p><a href="${appUrl}" style="color: #b91c1c;">Open Nondies Fantasy League</a></p>
</body>
</html>
`.trim();

const textBody = `Quick reminder from Nondies Fantasy League.

You still need to complete your team selection for this week.
Open the app and save your team before lock:
${appUrl}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hasCompleteTeam(data) {
  const players = Array.isArray(data?.players) ? data.players : [];
  const captain = data?.captain;
  const viceCaptain = data?.viceCaptain;
  const keeper = data?.keeper;
  const name = typeof data?.name === "string" ? data.name.trim() : "";

  if (name.length === 0) return false;
  if (players.length !== squadSize) return false;
  if (!players.includes(captain)) return false;
  if (!players.includes(viceCaptain)) return false;
  if (!players.includes(keeper)) return false;
  return true;
}

async function listAuthUsersByUid() {
  const map = new Map();
  let pageToken;
  do {
    const res = await admin.auth().listUsers(1000, pageToken);
    for (const u of res.users) {
      const e = u.email?.trim();
      if (!e) continue;
      map.set(u.uid, {
        uid: u.uid,
        email: e,
        displayName: u.displayName?.trim() || e,
      });
    }
    pageToken = res.pageToken;
  } while (pageToken);
  return map;
}

async function listCompletedTeamUids() {
  const snap = await db.collection("teams").get();
  const completed = new Set();
  for (const d of snap.docs) {
    if (hasCompleteTeam(d.data())) completed.add(d.id);
  }
  return completed;
}

async function sendViaResend(to, recipientName) {
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
      html: htmlBody.replace("Quick reminder from Nondies Fantasy League 👋", `Quick reminder for ${recipientName} 👋`),
      text: textBody,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Resend ${res.status}: ${t}`);
  }
}

const authUsersByUid = await listAuthUsersByUid();
const completedUids = await listCompletedTeamUids();

const recipients = [...authUsersByUid.values()]
  .filter((u) => !completedUids.has(u.uid))
  .sort((a, b) => a.email.localeCompare(b.email));

console.log(`Auth users with email: ${authUsersByUid.size}`);
console.log(`Completed teams: ${completedUids.size}`);
console.log(`Needs reminder: ${recipients.length}\n`);
recipients.forEach((r) => console.log(`  ${r.email}`));

if (dryRun) {
  console.log(`
--- Dry run (no emails sent) ---
To send for real:
  1) Set RESEND_API_KEY, MAIL_FROM, APP_URL
  2) Run with SEND_CONFIRM=yes
`);
  process.exit(0);
}

if (!resendKey) {
  console.error("Set RESEND_API_KEY to send email.");
  process.exit(1);
}

let ok = 0;
let fail = 0;
for (const r of recipients) {
  try {
    await sendViaResend(r.email, r.displayName);
    console.log(`OK  ${r.email}`);
    ok += 1;
  } catch (e) {
    console.error(`ERR ${r.email} — ${e.message}`);
    fail += 1;
  }
  await sleep(350);
}

console.log(`\nDone. Sent: ${ok}, failed: ${fail}`);
