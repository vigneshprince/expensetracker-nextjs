import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { sender, body, timestamp } = json;

    if (!sender || !body) {
      return NextResponse.json({ success: false, message: 'Missing fields' }, { status: 400 });
    }

    // Filter: Only transactions
    const isTransaction = /debited|spent/i.test(body);
    if (!isTransaction) {
      console.log(`[SMS Skipped] No keywords found: ${body.substring(0, 30)}...`);
      return NextResponse.json({ success: true, message: 'SMS Skipped' });
    }

    // However, the current UI expects 'emailId'. We can generate a dummy ID.

    // For now, let's just log it to verify integration.
    console.log(`[SMS Received] From: ${sender} | Body: ${body}`);

    await adminDb.collection('mailstaging').add({
      type: 'sms',
      emailId: `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Fake ID
      userEmail: 'unknown_mobile', // Hardcoded as requested
      sender: sender,
      emailContent: body, // Reuse this field for content
      receivedAt: Timestamp.fromMillis(timestamp || Date.now()),
      status: 'pending',
      createdAt: Timestamp.now()
    });

    return NextResponse.json({ success: true, message: 'SMS Staged' });

  } catch (error: any) {
    console.error('SMS Hook Error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Unknown Server Error' },
      { status: 500 }
    );
  }
}
