'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-4xl w-full text-center space-y-8">
        {/* Logo/Title */}
        <div className="space-y-4">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
            OpenClaw
          </h1>
          <p className="text-2xl text-slate-300">
            Your Personal AI Assistant, Hosted
          </p>
        </div>

        {/* Description */}
        <div className="card max-w-2xl mx-auto space-y-4">
          <p className="text-lg text-slate-300">
            Get your own dedicated OpenClaw instance running in the cloud.
            Connect your API keys, launch your gateway, and start using your
            personal AI assistant in minutes.
          </p>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/auth?mode=signup" className="btn-primary px-8 py-3 text-lg">
            Create Account
          </Link>
          <Link href="/auth?mode=signin" className="btn-secondary px-8 py-3 text-lg">
            Sign In
          </Link>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mt-12">
          <div className="card text-left space-y-2">
            <div className="text-primary-400 text-3xl">🚀</div>
            <h3 className="text-lg font-semibold">Launch in Minutes</h3>
            <p className="text-slate-400 text-sm">
              Enter your API keys and get your gateway running instantly
            </p>
          </div>
          <div className="card text-left space-y-2">
            <div className="text-primary-400 text-3xl">🔒</div>
            <h3 className="text-lg font-semibold">Secure & Isolated</h3>
            <p className="text-slate-400 text-sm">
              Each gateway runs in its own isolated container with dedicated storage
            </p>
          </div>
          <div className="card text-left space-y-2">
            <div className="text-primary-400 text-3xl">⚡</div>
            <h3 className="text-lg font-semibold">Always Available</h3>
            <p className="text-slate-400 text-sm">
              Your gateway stays running and accessible whenever you need it
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
