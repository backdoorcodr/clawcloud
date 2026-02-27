'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getIdToken } from '@/lib/auth';

type Status = 'starting' | 'running' | 'healthy' | 'stopped' | 'failed' | 'not-found';

type Toast = {
  message: string;
  type: 'success' | 'error';
} | null;

export default function DashboardPage() {
  const router = useRouter();
  
  const [status, setStatus] = useState<Status>('starting');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);
  
  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    // Check authentication
    getIdToken().then(token => {
      if (!token) {
        router.push('/auth?mode=signin');
        return;
      }
      pollStatus();
    });

    // Poll status every 5 seconds
    const interval = setInterval(pollStatus, 5000);
    return () => clearInterval(interval);
  }, [router]);

  const pollStatus = async () => {
    try {
      const token = await getIdToken();
      if (!token) {
        router.push('/auth?mode=signin');
        return;
      }

      const response = await fetch('/api/instance/status', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch status');
      }

      const data = await response.json();
      setStatus(data.status);
      setLoading(false);

      // If healthy, fetch the gateway URL
      if (data.status === 'healthy' && !gatewayUrl) {
        const infoResponse = await fetch('/api/instance/info', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (infoResponse.ok) {
          const infoData = await infoResponse.json();
          setGatewayUrl(infoData.url);
        }
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to fetch status', type: 'error' });
      setLoading(false);
    }
  };

  // Show error toast when status becomes failed
  useEffect(() => {
    if (status === 'failed') {
      setToast({ message: '❌ Launch failed. Please try again or contact support.', type: 'error' });
    }
  }, [status]);

  const getStatusMessage = () => {
    switch (status) {
      case 'starting':
        return {
          title: '🚀 Launching Your Gateway',
          message: 'Setting up your personal OpenClaw instance...',
          color: 'text-primary-400',
        };
      case 'running':
        return {
          title: '⚙️ Gateway Starting',
          message: 'Your instance is running and initializing...',
          color: 'text-yellow-400',
        };
      case 'healthy':
        return {
          title: '✅ Gateway Ready!',
          message: 'Your OpenClaw instance is running and ready to use',
          color: 'text-green-400',
        };
      case 'stopped':
        return {
          title: '⏸️ Gateway Stopped',
          message: 'Your instance has been stopped',
          color: 'text-slate-400',
        };
      case 'failed':
        return {
          title: '❌ Launch Failed',
          message: 'Something went wrong. Please try again or contact support',
          color: 'text-red-400',
        };
      case 'not-found':
        return {
          title: '🔍 No Gateway Found',
          message: 'You haven\'t launched a gateway yet',
          color: 'text-slate-400',
        };
      default:
        return {
          title: 'Checking Status...',
          message: 'Please wait',
          color: 'text-slate-400',
        };
    }
  };

  const statusInfo = getStatusMessage();

  if (status === 'not-found') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card max-w-lg w-full text-center space-y-6">
          <div className="text-6xl">🔍</div>
          <div>
            <h1 className="text-2xl font-bold text-slate-200 mb-2">No Gateway Found</h1>
            <p className="text-slate-400">
              You haven't launched your gateway yet. Let's set it up!
            </p>
          </div>
          <button
            onClick={() => router.push('/setup')}
            className="btn-primary"
          >
            Configure Gateway
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card max-w-2xl w-full space-y-8">
        {/* Status Display */}
        <div className="text-center space-y-4">
          <div className="text-6xl">{status === 'healthy' ? '✅' : '🚀'}</div>
          <div>
            <h1 className={`text-3xl font-bold ${statusInfo.color} mb-2`}>
              {statusInfo.title}
            </h1>
            <p className="text-slate-300 text-lg">
              {statusInfo.message}
            </p>
          </div>
        </div>

        {/* Loading Spinner */}
        {(status === 'starting' || status === 'running') && (
          <div className="flex justify-center">
            <div className="spinner w-12 h-12"></div>
          </div>
        )}

        {/* Gateway URL (when ready) */}
        {status === 'healthy' && gatewayUrl && (
          <div className="space-y-4">
            <div className="bg-green-900/20 border border-green-700 rounded-lg p-6 text-center space-y-4">
              <p className="text-green-300 font-medium">
                Your gateway is ready! Access it at:
              </p>
              <div className="bg-slate-900 rounded-lg p-4">
                <code className="text-green-400 text-lg break-all">
                  {gatewayUrl}
                </code>
              </div>
              <a
                href={gatewayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex"
              >
                Open Gateway →
              </a>
            </div>

            <div className="text-center text-sm text-slate-400">
              <p>💡 Bookmark this URL to access your gateway anytime</p>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === 'error' ? 'bg-red-900/90 border border-red-500 text-red-200' : 'bg-green-900/90 border border-green-500 text-green-200'
          }`}>
            <div className="flex items-center gap-2">
              <span>{toast.message}</span>
              <button 
                onClick={() => setToast(null)}
                className="ml-2 hover:opacity-80"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Status Timeline */}
        <div className="border-t border-slate-700 pt-6">
          <h3 className="text-sm font-medium text-slate-400 mb-4">Launch Progress</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-sm">
                ✓
              </div>
              <span className="text-slate-300">Configuration submitted</span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-sm ${
                status !== 'starting' ? 'bg-green-500' : 'bg-slate-600'
              }`}>
                {status !== 'starting' ? '✓' : '2'}
              </div>
              <span className={status !== 'starting' ? 'text-slate-300' : 'text-slate-500'}>
                Container launching
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-sm ${
                status === 'healthy' ? 'bg-green-500' : 'bg-slate-600'
              }`}>
                {status === 'healthy' ? '✓' : '3'}
              </div>
              <span className={status === 'healthy' ? 'text-slate-300' : 'text-slate-500'}>
                Gateway ready
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
