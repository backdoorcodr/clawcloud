/**
 * Vertical AI Agent Configurations
 * 
 * Defines pre-configured AI agents for specific use cases.
 * Each vertical includes skills, platform keys, plans, and system prompts.
 */

export type VerticalId = 'outreach' | 'sales-research';

export interface PlanConfig {
  creditsPerMonth: number;
  priceUSD: number;
  name: string;
}

export interface VerticalConfig {
  id: VerticalId;
  name: string;
  description: string;
  skills: string[];
  // Platform API keys that we inject (from env vars)
  platformKeys: string[];
  // Default LLM model for this vertical
  defaultModel: string;
  systemPromptFile: string;
  plans: Record<string, PlanConfig>;
}

export const VERTICALS: Record<VerticalId, VerticalConfig> = {
  outreach: {
    id: 'outreach',
    name: 'Outreach Agent',
    description: 'Automate personalized cold outreach via email and WhatsApp. Find leads, research them, and send personalized messages at scale.',
    skills: ['maton-agent-tools', 'brave-search'],
    platformKeys: ['APOLLO_API_KEY', 'BRAVE_API_KEY', 'MATON_API_KEY'],
    defaultModel: 'openrouter/anthropic/claude-3.5-sonnet',
    systemPromptFile: 'outreach-agent.md',
    plans: {
      starter: {
        name: 'Starter',
        creditsPerMonth: 1000,
        priceUSD: 29,
      },
      growth: {
        name: 'Growth',
        creditsPerMonth: 5000,
        priceUSD: 50,
      },
      scale: {
        name: 'Scale',
        creditsPerMonth: 12000,
        priceUSD: 129,
      },
    },
  },
  'sales-research': {
    id: 'sales-research',
    name: 'Sales Research Agent',
    description: 'Enrich your lead lists with deep research. Find recent news, company updates, and personal context for each prospect.',
    skills: ['brave-search', 'apollo-enrichment'],
    platformKeys: ['APOLLO_API_KEY', 'BRAVE_API_KEY'],
    defaultModel: 'openrouter/anthropic/claude-3.5-sonnet',
    systemPromptFile: 'sales-research-agent.md',
    plans: {
      starter: {
        name: 'Starter',
        creditsPerMonth: 500,
        priceUSD: 39,
      },
      growth: {
        name: 'Growth',
        creditsPerMonth: 2500,
        priceUSD: 79,
      },
      scale: {
        name: 'Scale',
        creditsPerMonth: 10000,
        priceUSD: 199,
      },
    },
  },
};

/**
 * Get vertical config by ID
 */
export function getVertical(id: VerticalId): VerticalConfig | undefined {
  return VERTICALS[id];
}

/**
 * Get plan config for a vertical
 */
export function getPlan(verticalId: VerticalId, planKey: string): PlanConfig | undefined {
  const vertical = VERTICALS[verticalId];
  return vertical?.plans[planKey];
}

/**
 * Get all available verticals for the setup wizard
 */
export function getAvailableVerticals(): VerticalConfig[] {
  return Object.values(VERTICALS);
}
