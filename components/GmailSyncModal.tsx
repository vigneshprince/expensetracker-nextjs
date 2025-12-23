'use client';

import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { syncEmailsAction, processStagingAction, getGmailAuthUrlAction, checkAutoSyncStatusAction } from '@/app/actions/gmailSync';
import { useCollection } from 'react-firebase-hooks/firestore';
import { collection, query, where, orderBy, deleteDoc, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { Loader2, Mail, RefreshCw, Check, X as XIcon, AlertCircle, Trash2, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

interface ParsedData {
  amount?: number;
  expenseName?: string;
  date?: string;
  category?: string;
  notes?: string;
}

interface StagingItem {
  id: string;
  emailId: string;
  receivedAt: Timestamp;
  status: 'pending' | 'review' | 'error' | 'rejected';
  parsedData?: string; // JSON string
  emailContent?: string;
  userEmail: string;
  type?: 'email' | 'sms';
  sender?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onReview: (item: StagingItem, data: ParsedData) => void;
  categories: { id: string; name: string }[];
  expenseDefs: { name: string; category: string }[];
}

export default function GmailSyncModal({ isOpen, onClose, onReview, categories, expenseDefs }: Props) {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  // Real-time listener for staging items - Only when open
  const [snapshot, loading, snapshotError] = useCollection(
    (user?.email && isOpen) ? query(
      collection(db, 'mailstaging'),
      where('userEmail', 'in', [user.email, 'unknown_mobile']),
      orderBy('receivedAt', 'desc')
    ) : null
  );

  if (snapshotError) {
    console.error("Firestore Staging Error:", snapshotError);
  }

  const stagingItems = (snapshot?.docs.map(d => ({ id: d.id, ...d.data() } as StagingItem)) || [])
    .sort((a, b) => {
      const tA = a.receivedAt?.toMillis() || 0;
      const tB = b.receivedAt?.toMillis() || 0;
      return tB - tA; // Newest first
    });

  const handleConnectAndSync = async () => {
    if (!user?.email) return;
    setSyncing(true);
    setError('');
    try {
      // 1. Get OAuth Token
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/gmail.readonly');

      // If user is already signed in, we might need to re-auth or link, 
      // but for "Sync" action, just asking for a fresh token via popup is usually safest/easiest 
      // to ensure we have a valid short-lived access token.
      // We use signInWithPopup. If they select the SAME account, it just returns credentials.

      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;

      if (!token) {
        throw new Error("Failed to get access token");
      }

      // 2. Sync Emails
      const syncRes = await syncEmailsAction(token, user.email);
      if (!syncRes.success) throw new Error(syncRes.message);

      // 3. Process with Gemini
      const processRes = await processStagingAction(user.email);
      if (!processRes.success) console.error("Processing warning:", processRes.message); // Don't block UI

    } catch (err: any) {
      console.error("Sync Error:", err);
      setError(err.message || "Failed to sync. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const handleRetry = async (item: StagingItem) => {
    if (!user?.email) return;
    try {
      // Reset status to pending so backend picks it up?
      // Or call processStagingAction explicitly?
      // ProcessStagingAction picks up 'pending'.
      // So let's update doc to 'pending'.
      await updateDoc(doc(db, 'mailstaging', item.id), { status: 'pending', parsedData: null });
      // Then trigger backend processing
      const categoryNames = categories.map(c => c.name);
      const context = expenseDefs.slice(0, 50).map(e => {
        const catName = categories.find(c => c.id === e.category)?.name || 'Unknown';
        return `${e.name}: ${catName}`;
      }).join('\n');

      await processStagingAction(user.email, categoryNames, context);
    } catch (e) {
      console.error("Retry failed", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this staged item?")) {
      await deleteDoc(doc(db, 'mailstaging', id));
    }
  };

  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && user?.email) {
      checkAutoSyncStatusAction(user.email).then(res => {
        setIsAutoSyncEnabled(res.isEnabled);
        setLastSynced(res.lastSyncedAt || null);

        if (res.isEnabled) {
          // Rate-Limited Auto-Sync on Open
          const STORAGE_KEY = `gmail_last_auto_sync_${user.email}`;
          const lastAttempt = parseInt(localStorage.getItem(STORAGE_KEY) || '0');
          const now = Date.now();

          if (now - lastAttempt > 15 * 60 * 1000) {
            console.log("Auto-Sync (Modal): Triggering background sync...");
            // Set storage immediately to prevent double-fire
            localStorage.setItem(STORAGE_KEY, now.toString());

            syncEmailsAction(null, user.email!).then(syncRes => {
              if (syncRes.success && (syncRes.count || 0) > 0) {
                const categoryNames = categories.map(c => c.name);
                const context = expenseDefs.slice(0, 50).map(e => {
                  const catName = categories.find(c => c.id === e.category)?.name || 'Unknown';
                  return `${e.name}: ${catName}`;
                }).join('\n');
                processStagingAction(user.email!, categoryNames, context);
              }
              // Refresh status
              checkAutoSyncStatusAction(user.email!).then(status => {
                setLastSynced(status.lastSyncedAt || Date.now());
              });
            });
          } else {
            console.log("Auto-Sync (Modal): Skipped (Rate Limit Active)");
          }
        }
      });
    }
  }, [isOpen, user?.email]);

  // Separate Effect: Auto-Process Pending Items (e.g., SMS)
  useEffect(() => {
    if (isOpen && user?.email && stagingItems.length > 0) {
      const hasPending = stagingItems.some(i => i.status === 'pending');
      const AUTO_PROCESS_KEY = `gmail_last_auto_process_${user.email}`;
      const lastProcess = parseInt(localStorage.getItem(AUTO_PROCESS_KEY) || '0');
      const now = Date.now();

      // Debounce processing: Only if we haven't processed in the last 15 seconds
      if (hasPending && (now - lastProcess > 15 * 1000)) {
        console.log("Auto-Process: Found pending items, triggering Gemini...");
        localStorage.setItem(AUTO_PROCESS_KEY, now.toString());

        const categoryNames = categories.map(c => c.name);
        const context = expenseDefs.slice(0, 50).map(e => {
          const catName = categories.find(c => c.id === e.category)?.name || 'Unknown';
          return `${e.name}: ${catName}`;
        }).join('\n');

        processStagingAction(user.email, categoryNames, context);
      }
    }
  }, [isOpen, user?.email, stagingItems, categories, expenseDefs]);

  const handleSyncNow = async () => {
    if (!user?.email) return;
    setSyncing(true);
    setError('');
    try {
      // Use Backend Auto-Sync (pass null token)
      const syncRes = await syncEmailsAction(null, user.email);
      if (!syncRes.success) throw new Error(syncRes.message);

      // Reset Auto-Sync Timer on successful manual sync
      const STORAGE_KEY = `gmail_last_auto_sync_${user.email}`;
      localStorage.setItem(STORAGE_KEY, Date.now().toString());

      // Refresh status
      checkAutoSyncStatusAction(user.email).then(res => {
        setLastSynced(res.lastSyncedAt || Date.now());
      });

      // Process if needed
      // Process if needed
      const context = expenseDefs.slice(0, 50).map(e => {
        const catName = categories.find(c => c.id === e.category)?.name || 'Unknown';
        return `${e.name}: ${catName}`;
      }).join('\n');
      await processStagingAction(user.email, categories.map(c => c.name), context);

    } catch (err: any) {
      console.error("Sync Error:", err);
      setError(err.message || "Failed to sync. Please try again.");
    } finally {
      setSyncing(false);
    }
  };


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white rounded-t-2xl">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-red-50 text-red-600 rounded-lg">
              <Mail size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Message Sync</h2>
              <p className="text-xs text-gray-500">Sync transactions from your inbox</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
            <XIcon size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 custom-scrollbar">

          {/* Sync Status / Actions Compact */}
          <div className="mb-4">
            {isAutoSyncEnabled ? (
              <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span className="text-xs font-semibold text-green-700">Background Sync Active</span>
                  </div>
                  {lastSynced && (
                    <p className="text-[10px] text-gray-400 pl-4">
                      Last checked: {format(lastSynced, 'MMM d, h:mm a')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      const url = await getGmailAuthUrlAction();
                      window.location.href = url;
                    }}
                    className="text-[10px] text-gray-400 hover:text-gray-600 underline px-2"
                    title="Update Connection"
                  >
                    Update
                  </button>
                  <button
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-black disabled:bg-gray-400 transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                  >
                    {syncing ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                    {syncing ? 'Syncing...' : 'Sync Now'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-blue-50/50 rounded-xl border border-blue-100/50">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-100 text-blue-600 rounded-md">
                    <AlertCircle size={14} />
                  </div>
                  <p className="text-xs text-blue-800 font-medium">Enable background sync for auto-updates.</p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const url = await getGmailAuthUrlAction();
                      window.location.href = url;
                    } catch (e) {
                      console.error(e);
                      alert("Failed to start Auto-Sync flow");
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                >
                  <ExternalLink size={12} /> Enable
                </button>
              </div>
            )}

            {error && <p className="text-xs text-red-500 mt-2 font-medium bg-red-50 px-3 py-1 rounded-full text-center">{error}</p>}
          </div>

          {/* List */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Staged Transactions</h3>

            {loading && <div className="text-center py-10"><Loader2 className="animate-spin text-gray-400 mx-auto" /></div>}

            {!loading && stagingItems.length === 0 && (
              <div className="text-center py-10 text-gray-400 text-sm">
                No staged transactions found. Sync to get started.
              </div>
            )}

            {stagingItems.map(item => {
              let parsed: ParsedData | null = null;
              try {
                if (item.parsedData) parsed = JSON.parse(item.parsedData);
              } catch (e) { /* ignore */ }

              return (
                <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${item.status === 'review' ? 'bg-green-100 text-green-700' :
                          item.status === 'error' ? 'bg-red-100 text-red-700' :
                            'bg-yellow-100 text-yellow-700'
                          }`}>
                          {item.status}
                        </span>
                        <span className="text-xs text-gray-400">
                          {item.receivedAt ? format(item.receivedAt.toDate(), 'MMM d, h:mm a') : 'Unknown Date'}
                        </span>
                        {item.type === 'sms' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">
                            SMS
                          </span>
                        )}
                      </div>

                      {parsed ? (
                        <>
                          <h4 className="font-semibold text-gray-900 truncate">{parsed.expenseName || 'Unknown Expense'}</h4>
                          <div className="flex items-baseline gap-1 text-gray-900 mt-0.5">
                            <span className="text-xs text-gray-500">Rs.</span>
                            <span className="font-bold text-lg">{parsed.amount?.toLocaleString() || '0'}</span>
                          </div>
                          {item.type === 'sms' && item.sender && (
                            <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                              <Mail size={10} /> From: <span className="font-medium">{item.sender}</span>
                            </p>
                          )}
                          {parsed.category && (
                            <p className="text-xs text-gray-500 mt-1">
                              Category: <span className="font-medium text-gray-700">{parsed.category}</span>
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="py-2">
                          <p className="text-sm text-gray-500 italic mb-1">
                            {item.status === 'error' ? 'Parser failed. Click Retry to try again.' : 'Processing...'}
                          </p>
                          {/* Show snippet to debug "empty" issue */}
                          <p className="text-xs text-gray-400 line-clamp-2">
                            {(item.emailContent || "").substring(0, 150)}...
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      {item.status === 'review' && parsed && (
                        <button
                          onClick={() => onReview(item, parsed!)}
                          className="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-xs font-semibold hover:bg-green-100 border border-green-200 transition-colors flex items-center justify-center gap-1"
                        >
                          <Check size={14} /> Review
                        </button>
                      )}

                      {item.status === 'error' && (
                        <button
                          onClick={() => handleRetry(item)}
                          className="px-3 py-1.5 bg-yellow-50 text-yellow-600 rounded-lg text-xs font-semibold hover:bg-yellow-100 border border-yellow-200 transition-colors flex items-center justify-center gap-1"
                        >
                          <RefreshCw size={14} /> Retry
                        </button>
                      )}

                      <button
                        onClick={() => handleDelete(item.id)}
                        className="px-3 py-1.5 bg-gray-50 text-gray-400 rounded-lg text-xs font-semibold hover:bg-red-50 hover:text-red-500 border border-transparent hover:border-red-100 transition-colors flex items-center justify-center gap-1"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
