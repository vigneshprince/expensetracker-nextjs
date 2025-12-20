import "server-only";
import * as admin from "firebase-admin";

interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function formatPrivateKey(key: string) {
  return key.replace(/\\n/g, "\n");
}

if (!admin.apps.length) {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (serviceAccountKey) {
    // Used for local development or when full JSON is provided
    try {
      const config = JSON.parse(serviceAccountKey);
      admin.initializeApp({
        credential: admin.credential.cert(config),
      });
      console.log("Firebase Admin Initialized with JSON Config");
    } catch (error) {
      console.error("Firebase Admin Error: Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON", error);
    }
  } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    // Used for Vercel/Production env vars
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY || ""),
      }),
    });
    console.log("Firebase Admin Initialized with Env Vars");
  } else {
    // Fallback to Application Default Credentials (Google Cloud)
    admin.initializeApp();
    console.log("Firebase Admin Initialized with Default Credentials");
  }
}

export const adminDb = admin.firestore();
