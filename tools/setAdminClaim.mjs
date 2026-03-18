import admin from "firebase-admin";
import { readFileSync } from "node:fs";

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountPath) {
  throw new Error("Set FIREBASE_SERVICE_ACCOUNT_JSON to your service account json path.");
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const email = "ox.bletchingdoncc@gmail.com";

const user = await admin.auth().getUserByEmail(email);
await admin.auth().setCustomUserClaims(user.uid, { admin: true });

console.log(`Admin claim set for ${email} (uid: ${user.uid})`);