'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getIdToken } from '@/lib/auth';

export default function SetupPage() {
  const router = useRouter();
  
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [apolloKey, setApolloKey] = useState('');
  const [matonKey, setMatonKey] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Check if user is authenticated
    getIdToken().then(token => {
      if (!token) {
        router.push('/auth?mode=signin');
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!openrouterKey || !apolloKey || !matonKey) {
      setError('Please fill in all API keys');
      return;
    }

    setLoading(true);

    try {
      const token = await getIdToken();
      if (!token) {
        router.push('/auth?mode=signin');
        return;
      }

      const response = await fetch('/api/instance/launch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          llmKey: openrouterKey,
          llmProvider: 'openrouter',
          apolloKey,
          matonKey,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to launch instance');
      }

      // Redirect to dashboard to watch the launch progress
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to launch instance');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card max-w-2xl w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
            Configure Your Gateway
          </h1>
          <p className="text-slate-400 mt-2">
            Enter your API keys to launch your personal OpenClaw instance
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* OpenRouter Key */}
          <div>
            <label htmlFor="openrouter" className="block text-sm font-medium text-slate-300 mb-2">
              OpenRouter API Key <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                id="openrouter"
                type={showKeys ? 'text' : 'password'}
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                className="input-field pr-12"
                placeholder="sk-or-v1-..."
                required
              />
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Get your key from{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-400 hover:text-primary-300"
              >
                openrouter.ai/keys
              </a>
            </p>
          </div>

          {/* Apollo Key */}
          <div>
            <label htmlFor="apollo" className="block text-sm font-medium text-slate-300 mb-2">
              Apollo API Key <span className="text-red-400">*</span>
            </label>
            <input
              id="apollo"
              type={showKeys ? 'text' : 'password'}
              value={apolloKey}
              onChange={(e) => setApolloKey(e.target.value)}
              className="input-field"
              placeholder="apollo_..."
              required
            />
            <p className="text-sm text-slate-400 mt-1">
              Required for web search capabilities
            </p>
          </div>

          {/* Maton Key */}
          <div>
            <label htmlFor="maton" className="block text-sm font-medium text-slate-300 mb-2">
              Maton API Key <span className="text-red-400">*</span>
            </label>
            <input
              id="maton"
              type={showKeys ? 'text' : 'password'}
              value={matonKey}
              onChange={(e) => setMatonKey(e.target.value)}
              className="input-field"
              placeholder="maton_..."
              required
            />
            <p className="text-sm text-slate-400 mt-1">
              Required for automation features
            </p>
          </div>

          {/* Show/Hide Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showKeys"
              checked={showKeys}
              onChange={(e) => setShowKeys(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-primary-600 focus:ring-2 focus:ring-primary-500"
            />
            <label htmlFor="showKeys" className="text-sm text-slate-300">
              Show API keys
            </label>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-700 text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-primary-900/20 border border-primary-700 text-primary-300 px-4 py-3 rounded-lg text-sm">
            <strong>🔒 Security:</strong> Your API keys are encrypted and stored securely.
            They never leave AWS and are only accessible by your gateway instance.
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full text-lg py-3"
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Launching Gateway...
              </>
            ) : (
              <>
                🚀 Launch My Gateway
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
