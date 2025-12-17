'use client';

import { useAuth } from './AuthProvider';
// Button import removed
// Actually I'll use standard Tailwind classes first.

export default function Login() {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Welcome to Expense Tracker</h1>
        <p className="text-gray-600">Please sign in to continue</p>
        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-700 hover:bg-gray-50 font-medium transition-colors shadow-sm"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
