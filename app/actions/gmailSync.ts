'use server';

import { google } from 'googleapis';
import { adminDb } from '@/lib/firebaseAdmin';
import { Timestamp, FieldPath } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEN_AI_KEY = process.env.GOOGLE_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEN_AI_KEY);

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/dashboard'; // TODO: Make dynamic or env var if needed

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Helper to recursively find text content
function extractBody(parts: any[]): string {
  let text = '';
  // Prioritize simple structure, but we want all text/html
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text += `\n--- Text Content ---\n${Buffer.from(part.body.data, 'base64').toString('utf-8')}`;
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      text += `\n--- HTML Content ---\n${Buffer.from(part.body.data, 'base64').toString('utf-8')}`;
    } else if (part.parts) {
      // Recurse
      text += extractBody(part.parts);
    }
  }
  return text;
}

export async function getGmailAuthUrlAction() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing Gmail OAuth Credentials");
  }

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Crucial for Refresh Token
    scope: scopes,
    prompt: 'consent', // Force consent to ensure we get a refresh token
    include_granted_scopes: true
  });
}

export async function exchangeAndStoreTokenAction(code: string, userEmail: string) {
  if (!code || !userEmail) return { success: false, message: "Missing code or email" };

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      // This happens if user re-auths without prompt:'consent' usually, but we forced it.
      // Or if they already granted offline access previously?
      console.warn("No refresh token returned. User might need to revoke access first.");
    }

    // Store in secure collection
    // users/{uid}/secrets/gmail
    // We need uid. But userEmail is passed. Let's assume we can query user by email or just store in a way we can find.
    // Ideally we pass UID from frontend. But validation is key.
    // Let's store in `mailstaging/${userEmail}_secrets` for now? No, insecure.
    // Let's store in root `secrets/{userEmail}` ?
    // Or standard `users/{userEmail}/secrets/gmail`.
    // Since we don't have UID handy in this action easily without passing it... let's accept UID too?
    // Or just key by email for this MVP since our cursor uses email.

    await adminDb.collection('user_secrets').doc(userEmail).set({
      gmail_refresh_token: tokens.refresh_token,
      updatedAt: Timestamp.now(),
      email: userEmail
    }, { merge: true });

    return { success: true, message: "Auto-Sync Enabled!" };

  } catch (error: any) {
    console.error("Token Exchange Error:", error);
    return { success: false, message: error.message || "Failed to exchange token" };
  }
}

interface SyncResult {
  success: boolean;
  message: string;
  count?: number;
}

export async function checkAutoSyncStatusAction(userEmail: string) {
  if (!userEmail) return { isEnabled: false };
  try {
    const doc = await adminDb.collection('user_secrets').doc(userEmail).get();
    const data = doc.data();
    return {
      isEnabled: !!data?.gmail_refresh_token,
      lastSyncedAt: data?.lastSyncedAt ? (data.lastSyncedAt as Timestamp).toMillis() : null
    };
  } catch (error) {
    console.error("Check Status Error:", error);
    return { isEnabled: false };
  }
}

export async function syncEmailsAction(accessToken: string | null, userEmail: string): Promise<SyncResult> {
  if (!userEmail) {
    return { success: false, message: 'Missing email' };
  }

  try {
    const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);

    if (accessToken) {
      auth.setCredentials({ access_token: accessToken });
    } else {
      // Try Auto-Sync with Refresh Token
      const secretDoc = await adminDb.collection('user_secrets').doc(userEmail).get();
      const secretData = secretDoc.data();

      if (!secretData?.gmail_refresh_token) {
        return { success: false, message: 'No Auto-Sync credentials found. Please enable it.' };
      }

      auth.setCredentials({ refresh_token: secretData.gmail_refresh_token });

      // Force refresh to ensure valid access token
      try {
        const { credentials } = await auth.refreshAccessToken();
        auth.setCredentials(credentials); // Update with new access token
      } catch (tokenError) {
        console.error("Refresh Token Failed:", tokenError);
        return { success: false, message: 'Auto-Sync session expired. Please re-enable.' };
      }
    }

    const gmail = google.gmail({ version: 'v1', auth });

    // 1. Get Cursor
    const cursorDocRef = adminDb.collection('mailstaging').doc(`${userEmail}_sync_cursor`);
    const cursorDoc = await cursorDocRef.get();

    let query = 'label:transactions';
    let cursorData: any = null;

    if (cursorDoc.exists) {
      cursorData = cursorDoc.data();
      if (cursorData?.last_date) {
        // Gmail query 'after:SecondsSinceEpoch'
        // last_date is likely a Timestamp, convert to seconds
        const seconds = Math.floor(cursorData.last_date.toMillis() / 1000);
        query += ` after:${seconds}`;
      }
    }

    // 2. List Messages
    // If no cursor, limit to last 2. if cursor, limit to 20
    const maxResults = cursorDoc.exists ? 20 : 2;

    console.log(`[Gmail Sync] Query: "${query}" | Max: ${maxResults}`);

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: maxResults,
    });

    console.log('[Gmail Sync] List Response:', JSON.stringify(response.data, null, 2));

    const messages = response.data.messages || [];

    if (messages.length === 0) {
      console.log('[Gmail Sync] No messages found.');
      // Update last synced time even if empty
      await adminDb.collection('user_secrets').doc(userEmail).set({ lastSyncedAt: Timestamp.now() }, { merge: true });
      return { success: true, message: 'No new emails found', count: 0 };
    }

    const lastEntry = cursorData?.last_entry;

    let newMessages = messages;
    if (lastEntry) {
      const limitIndex = messages.findIndex(m => m.id === lastEntry);
      if (limitIndex !== -1) {
        console.log(`[Gmail Sync] Found watermark ID ${lastEntry} at index ${limitIndex}. Skipping older.`);
        newMessages = messages.slice(0, limitIndex);
      }
    }

    if (newMessages.length === 0) {
      console.log('[Gmail Sync] No new emails after watermark.');
      // Update timestamp anyway
      await adminDb.collection('user_secrets').doc(userEmail).set({ lastSyncedAt: Timestamp.now() }, { merge: true });
      return { success: true, message: 'No new emails (up to date)', count: 0 };
    }

    console.log(`[Gmail Sync] Found ${newMessages.length} NEW messages to fetch.`);

    // 3. Fetch Full Content & Staging
    const batch = adminDb.batch();
    let latestEmailId = '';
    let latestDate = 0;

    for (const msg of newMessages) {
      if (!msg.id) continue;

      // Capture the ID of the FIRST (newest) message processed to save as watermark
      if (!latestEmailId) latestEmailId = msg.id;

      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const payload = fullMsg.data.payload;
      if (!payload) continue;

      const headers = payload.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
      const from = headers.find(h => h.name === 'From')?.value || '(Unknown)';
      const internalDate = parseInt(fullMsg.data.internalDate || '0');

      if (internalDate > latestDate) {
        latestDate = internalDate;
      }

      // Recursive Body Extraction
      let emailContent = extractBody(payload.parts || []); // Pass parts to extractBody, or empty array if no parts

      console.log(`[Gmail Sync] Staging: ${msg.id} | ${subject}`);

      const stagingRef = adminDb.collection('mailstaging').doc(msg.id);
      batch.set(stagingRef, {
        emailId: msg.id,
        receivedAt: Timestamp.fromMillis(internalDate),
        status: 'pending',
        emailContent: emailContent || "(No Content Extracted)",
        // No fullBody to save space
        userEmail: userEmail,
        createdAt: Timestamp.now()
      });
    }

    await batch.commit();

    // 4. Update Cursor
    const updates: any = {
      updatedAt: Timestamp.now(),
    };

    if (latestDate > 0) {
      updates.last_date = Timestamp.fromMillis(latestDate);
    }
    if (latestEmailId) {
      updates.last_entry = latestEmailId;
    }

    if (Object.keys(updates).length > 1) {
      await cursorDocRef.set(updates, { merge: true });
    }

    // Update user Last Synced time
    await adminDb.collection('user_secrets').doc(userEmail).set({
      lastSyncedAt: Timestamp.now()
    }, { merge: true });

    return {
      success: true,
      message: `Synced ${newMessages.length} emails`,
      count: newMessages.length
    };

  } catch (error: any) {
    console.error('Gmail Sync Error:', error);
    return { success: false, message: error.message || 'Failed to sync emails' };
  }
}

export async function processStagingAction(userEmail: string) {
  if (!GEN_AI_KEY) {
    return { success: false, message: "Missing Gemini API Key" };
  }

  try {
    const stagingRef = adminDb.collection('mailstaging');
    // Process pending items
    const snapshot = await stagingRef
      .where('userEmail', '==', userEmail)
      .where('status', '==', 'pending')
      .limit(10)
      .get();

    if (snapshot.empty) {
      return { success: true, message: "No pending items to process", count: 0 };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const batch = adminDb.batch();
    let processedCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      // Use emailContent (decoded body)
      const content = data.emailContent;

      if (!content || content.length < 10) {
        // Skip empty content
        continue;
      }

      const prompt = `
        You are an expense parser. Extract transaction details from this email.
        
        Email Content:
        "${content.substring(0, 15000)}" 

        Return JSON String ONLY (no markdown):
        {
          "amount": number,
          "expenseName": "Short Title",
          "date": "YYYY-MM-DD",
          "category": "Suggested Category",
          "notes": "Sender/Vendor info",
          "refundRequired": boolean // True if this is a work expense, reimbursement, or personal loan
        }
        
        Rules:
        - If multiple transactions, pick the main one.
        - If NO transaction found, return null (the word null).
        - Detect if the email implies this is a "reimbursable" expense (e.g. "Work trip", "Project expenses") or implies a personal loan.
      `;

      try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();

        if (text === "null") {
          console.log(`[Gemini Process] Doc ${doc.id} -> Rejected (null)`);
          batch.update(doc.ref, { status: 'error', updatedAt: Timestamp.now() });
        } else {
          // Validate JSON
          JSON.parse(text);
          console.log(`[Gemini Process] Doc ${doc.id} -> Success`);
          batch.update(doc.ref, {
            parsedData: text,
            status: 'review',
            updatedAt: Timestamp.now()
          });
          processedCount++;
        }
      } catch (err) {
        console.error(`[Gemini Process] Error for ${doc.id}:`, err);
        batch.update(doc.ref, { status: 'error', updatedAt: Timestamp.now() });
      }
    }

    await batch.commit();
    return { success: true, message: `Processed ${processedCount} items`, count: processedCount };

  } catch (error) {
    console.error("Process Staging Error:", error);
    return { success: false, message: "Processing failed" };
  }
}
