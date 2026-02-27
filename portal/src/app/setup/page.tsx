'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getIdToken } from '@/lib/auth';

type SetupStep = 'vertical' | 'plan' | 'context' | 'launching';

interface Vertical {
  id: string;
  name: string;
  description: string;
  skills: string[];
  plans: Record<string, { name: string; creditsPerMonth: number; priceUSD: number }>;
}

const VERTICALS: Vertical[] = [
  {
    id: 'outreach',
    name: 'Outreach Agent',
    description: 'Automate personalized cold outreach via email and WhatsApp. Find leads, research them, and send personalized messages at scale.',
    skills: ['maton-agent-tools', 'brave-search'],
    plans: {
      starter: { name: 'Starter', creditsPerMonth: 1000, priceUSD: 29 },
      growth: { name: 'Growth', creditsPerMonth: 5000, priceUSD: 50 },
      scale: { name: 'Scale', creditsPerMonth: 12000, priceUSD: 129 },
    },
  },
  {
    id: 'sales-research',
    name: 'Sales Research Agent',
    description: 'Enrich your lead lists with deep research. Find recent news, company updates, and personal context for each prospect.',
    skills: ['brave-search', 'apollo-enrichment'],
    plans: {
      starter: { name: 'Starter', creditsPerMonth: 500, priceUSD: 39 },
      growth: { name: 'Growth', creditsPerMonth: 2500, priceUSD: 79 },
      scale: { name: 'Scale', creditsPerMonth: 10000, priceUSD: 199 },
    },
  },
];

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>('vertical');
  const [selectedVertical, setSelectedVertical] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [businessContext, setBusinessContext] = useState('');
  const [icpDescription, setIcpDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getIdToken().then(token => {
      if (!token) {
        router.push('/auth?mode=signin');
      }
    });
  }, [router]);

  const handleVerticalSelect = (verticalId: string) => {
    setSelectedVertical(verticalId);
    setStep('plan');
  };

  const handlePlanSelect = (planKey: string) => {
    setSelectedPlan(planKey);
    setStep('context');
  };

  const handleLaunch = async () => {
    if (!selectedVertical || !selectedPlan) {
      setError('Please complete all steps');
      return;
    }

    setError('');
    setLoading(true);
    setStep('launching');

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
          vertical: selectedVertical,
          plan: selectedPlan,
          icpDescription: icpDescription,
          businessContext: businessContext,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to launch instance');
      }

      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to launch instance');
      setLoading(false);
      setStep('context');
    }
  };

  const currentVertical = VERTICALS.find(v => v.id === selectedVertical);
  const currentPlan = currentVertical && selectedPlan ? currentVertical.plans[selectedPlan] : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card max-w-2xl w-full space-y-6">
        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <StepIndicator number={1} label="Vertical" active={step === 'vertical'} completed={step !== 'vertical'} />
          <div className="w-8 h-px bg-slate-600" />
          <StepIndicator number={2} label="Plan" active={step === 'plan'} completed={step === 'context' || step === 'launching'} />
          <div className="w-8 h-px bg-slate-600" />
          <StepIndicator number={3} label="Your Business" active={step === 'context'} completed={step === 'launching'} />
        </div>

        {/* Step 1: Select Vertical */}
        {step === 'vertical' && (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                Choose Your AI Agent
              </h1>
              <p className="text-slate-400 mt-2">
                Pick a pre-configured agent for your use case — no API keys needed
              </p>
            </div>

            <div className="space-y-4">
              {VERTICALS.map((vertical) => (
                <button
                  key={vertical.id}
                  onClick={() => handleVerticalSelect(vertical.id)}
                  className="w-full text-left p-6 rounded-xl border border-slate-700 bg-slate-800/50 hover:border-primary-500 hover:bg-slate-800 transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-white group-hover:text-primary-400">
                        {vertical.name}
                      </h3>
                      <p className="text-slate-400 mt-2">
                        {vertical.description}
                      </p>
                      <div className="flex gap-2 mt-3">
                        {vertical.skills.map((skill) => (
                          <span key={skill} className="text-xs px-2 py-1 rounded-full bg-slate-700 text-slate-300">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-primary-400 text-2xl">→</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Step 2: Select Plan */}
        {step === 'plan' && currentVertical && (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                Choose Your Plan
              </h1>
              <p className="text-slate-400 mt-2">
                {currentVertical.name} — {currentVertical.description}
              </p>
            </div>

            <div className="grid gap-4">
              {Object.entries(currentVertical.plans).map(([planKey, plan]) => (
                <button
                  key={planKey}
                  onClick={() => handlePlanSelect(planKey)}
                  className="w-full text-left p-6 rounded-xl border border-slate-700 bg-slate-800/50 hover:border-primary-500 hover:bg-slate-800 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-white">
                        {plan.name}
                      </h3>
                      <p className="text-slate-400 mt-1">
                        {plan.creditsPerMonth.toLocaleString()} {currentVertical.id === 'outreach' ? 'outreach' : 'research'} credits/month
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-3xl font-bold text-primary-400">${plan.priceUSD}</span>
                      <span className="text-slate-400">/mo</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep('vertical')}
              className="text-slate-400 hover:text-white text-sm"
            >
              ← Back to agent selection
            </button>
          </>
        )}

        {/* Step 3: Business Context */}
        {step === 'context' && currentVertical && currentPlan && (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                Tell Us About Your Business
              </h1>
              <p className="text-slate-400 mt-2">
                This helps your AI agent personalize outreach for your target audience
              </p>
            </div>

            <div className="space-y-6">
              <div>
                <label htmlFor="business" className="block text-sm font-medium text-slate-300 mb-2">
                  What do you sell? What's your value proposition? <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="business"
                  value={businessContext}
                  onChange={(e) => setBusinessContext(e.target.value)}
                  className="input-field min-h-[100px]"
                  placeholder="e.g., We sell AI-powered customer support software that helps SaaS companies reduce support tickets by 40%."
                  required
                />
              </div>

              <div>
                <label htmlFor="icp" className="block text-sm font-medium text-slate-300 mb-2">
                  Describe your ideal customer <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="icp"
                  value={icpDescription}
                  onChange={(e) => setIcpDescription(e.target.value)}
                  className="input-field min-h-[120px]"
                  placeholder="e.g., B2B SaaS companies, 50-200 employees, US-based, looking to reduce support costs. Target: VP of Customer Success or CTO."
                  required
                />
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-700 text-red-400 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="bg-primary-900/20 border border-primary-700 text-primary-300 px-4 py-3 rounded-lg text-sm">
                <strong>🔒 What happens:</strong> We'll launch your {currentVertical.name} with platform API keys (no need to bring your own).
                Your agent will use your business context to personalize every outreach.
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => setStep('plan')}
                  className="btn-secondary flex-1"
                >
                  ← Back
                </button>
                <button
                  onClick={handleLaunch}
                  disabled={loading || !businessContext || !icpDescription}
                  className="btn-primary flex-1 text-lg py-3"
                >
                  🚀 Launch {currentVertical.name}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Launching State */}
        {step === 'launching' && (
          <div className="text-center py-12">
            <div className="spinner text-4xl mb-4" style={{ width: 48, height: 48 }}></div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Launching Your AI Agent...
            </h2>
            <p className="text-slate-400">
              This usually takes 60-90 seconds. Setting up {currentVertical?.name} with {currentPlan?.name} plan.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ number, label, active, completed }: { number: number; label: string; active: boolean; completed: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
          active
            ? 'bg-primary-500 text-white ring-4 ring-primary-500/30'
            : completed
            ? 'bg-green-500 text-white'
            : 'bg-slate-700 text-slate-400'
        }`}
      >
        {completed ? '✓' : number}
      </div>
      <span className={`text-xs mt-1 ${active ? 'text-primary-400' : 'text-slate-500'}`}>
        {label}
      </span>
    </div>
  );
}
