'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { verifyEmail, signIn } from '@/lib/auth';

function VerifyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setLoading(true);

    try {
      await verifyEmail({ email, code });
      // After verification, redirect to setup
      router.push('/setup');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
            Verify Your Email
          </h1>
          <p className="text-slate-400 mt-2">
            We sent a verification code to
          </p>
          <p className="text-slate-200 font-medium mt-1">{email}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-slate-300 mb-2">
              Verification Code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="input-field text-center text-2xl tracking-widest"
              placeholder="000000"
              maxLength={6}
              required
            />
            <p className="text-sm text-slate-400 mt-2">
              Enter the 6-digit code from your email
            </p>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-700 text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Verifying...
              </>
            ) : (
              'Verify Email'
            )}
          </button>
        </form>

        <div className="text-center">
          <p className="text-sm text-slate-400">
            Didn't receive the code?{' '}
            <button className="text-primary-400 hover:text-primary-300">
              Resend Code
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="spinner w-12 h-12"></div></div>}>
      <VerifyPageContent />
    </Suspense>
  );
}
