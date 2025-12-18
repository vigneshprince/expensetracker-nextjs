'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signInWithGoogle: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      if (currentUser) {
        // Check whitelist
        if (currentUser.email) {
          try {
            const q = query(collection(db, 'user'), where('email', '==', currentUser.email));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
              console.warn("Unauthorized email:", currentUser.email);
              await signOut(auth);
              setUser(null);
              alert("Access Denied: Your email is not authorized to access this application.");
            } else {
              setUser(currentUser);
            }
          } catch (error) {
            console.error("Error checking whitelist:", error);
            // Optional: Sign out on error to be safe, or allow pending retry? 
            // Better to allow retry or show error state. For now, let's just log.
            // If we sign out on network error, it might be annoying.
            // But for security, if cannot verify, maybe shouldn't allow?
            // Let's assume network is fine for now or handle gracefully.
            // We will NOT set user if error, effectively keeping them in loading or logged out state visually if we handled it right?
            // Actually, if we don't setUser(currentUser), they might just see loading forever if we don't setLoading(false).
            // Let's force signout on error to be safe.
            await signOut(auth);
            setUser(null);
            alert("Error verifying authorization. Please try again.");
          }
        } else {
          // No email? Should not happen with Google Auth usually
          await signOut(auth);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in with Google", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout }}>
      {loading ? (
        <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
           <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}
