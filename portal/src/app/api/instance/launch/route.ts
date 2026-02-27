import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { launchGatewayTask, saveUserInstance } from '@/lib/aws';
import { getVertical, getPlan, type VerticalId } from '@/lib/verticals';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

// Platform API keys (injected from environment - these are OUR keys, not user's)
const PLATFORM_KEYS: Record<string, string> = {
  APOLLO_API_KEY: process.env.APOLLO_API_KEY ?? '',
  BRAVE_API_KEY: process.env.BRAVE_API_KEY ?? '',
  MATON_API_KEY: process.env.MATON_API_KEY ?? '',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
};

export async function POST(request: NextRequest) {
  try {
    // Get user ID from Cognito JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const userId = payload.sub;

    // Parse request body
    const body = await request.json();
    const { vertical: verticalId, plan: planKey, icpDescription, businessContext } = body;

    // Check if this is a vertical-based launch (new flow) or legacy key-based launch
    const isVerticalLaunch = verticalId && planKey;

    if (isVerticalLaunch) {
      // === NEW FLOW: Vertical-based launch ===
      const vertical = getVertical(verticalId as VerticalId);
      const plan = getPlan(verticalId as VerticalId, planKey);

      if (!vertical) {
        return NextResponse.json(
          { error: `Invalid vertical: ${verticalId}` },
          { status: 400 }
        );
      }

      if (!plan) {
        return NextResponse.json(
          { error: `Invalid plan: ${planKey}` },
          { status: 400 }
        );
      }

      // Verify platform keys are configured
      if (!PLATFORM_KEYS.OPENROUTER_API_KEY) {
        return NextResponse.json(
          { error: 'Platform not configured: missing OPENROUTER_API_KEY' },
          { status: 500 }
        );
      }

      // Build secrets with PLATFORM keys (not user-provided)
      const secrets: Record<string, string> = {
        OPENROUTER_API_KEY: PLATFORM_KEYS.OPENROUTER_API_KEY,
      };

      // Add vertical-specific platform keys
      for (const key of vertical.platformKeys) {
        if (PLATFORM_KEYS[key]) {
          secrets[key] = PLATFORM_KEYS[key];
        }
      }

      // Generate gateway token
      const gatewayToken = randomUUID();

      // Build the system prompt with user context
      const systemPrompt = buildSystemPrompt(verticalId as VerticalId, {
        businessContext: businessContext || '',
        icpDescription: icpDescription || '',
      });

      // Launch ECS task with vertical config
      const taskArn = await launchGatewayTask({
        userId,
        secrets,
        gatewayToken,
        vertical: verticalId as VerticalId,
        plan: planKey,
        creditsLimit: plan.creditsPerMonth,
        systemPrompt,
      });

      // Save to DynamoDB with vertical info
      await saveUserInstance({
        userId,
        taskArn,
        gatewayToken,
        status: 'starting',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        vertical: verticalId as VerticalId,
        plan: planKey,
        creditsLimit: plan.creditsPerMonth,
        creditsUsed: 0,
      });

      return NextResponse.json({
        success: true,
        taskArn,
        vertical: verticalId,
        plan: planKey,
        credits: plan.creditsPerMonth,
      });
    } else {
      // === LEGACY FLOW: User provides their own keys ===
      const { llmKey, llmProvider, apolloKey, matonKey } = body;

      if (!llmKey || !llmProvider || !apolloKey || !matonKey) {
        return NextResponse.json(
          { error: 'Missing required keys' },
          { status: 400 }
        );
      }

      const llmKeyMap: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        openai: 'OPENAI_API_KEY',
      };

      const llmEnvKey = llmKeyMap[llmProvider];
      if (!llmEnvKey) {
        return NextResponse.json(
          { error: 'Invalid LLM provider' },
          { status: 400 }
        );
      }

      const secrets: Record<string, string> = {
        [llmEnvKey]: llmKey,
        APOLLO_API_KEY: apolloKey,
        MATON_API_KEY: matonKey,
      };

      const gatewayToken = randomUUID();

      const taskArn = await launchGatewayTask({
        userId,
        secrets,
        gatewayToken,
      });

      await saveUserInstance({
        userId,
        taskArn,
        gatewayToken,
        status: 'starting',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      });

      return NextResponse.json({
        success: true,
        taskArn,
      });
    }
  } catch (error: any) {
    console.error('Launch error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to launch instance' },
      { status: 500 }
    );
  }
}

function buildSystemPrompt(verticalId: VerticalId, context: { businessContext: string; icpDescription: string }): string {
  // Read the base prompt based on vertical
  let basePrompt = '';

  if (verticalId === 'outreach') {
    try {
      const promptPath = path.join(process.cwd(), 'portal/src/lib/outreach-prompt.md');
      if (fs.existsSync(promptPath)) {
        basePrompt = fs.readFileSync(promptPath, 'utf-8');
      }
    } catch (e) {
      console.warn('Could not read outreach-prompt.md, using fallback');
    }

    if (!basePrompt) {
      // Fallback minimal prompt
      basePrompt = `# Outreach Agent

You are an AI-powered sales development assistant. Your mission is to help users run effective outreach campaigns.

## Your Context
- Business: ${context.businessContext}
- Ideal Customer Profile: ${context.icpDescription}

## What You Do
1. Find prospects matching the ICP using Apollo
2. Research each prospect using Brave Search
3. Write personalized outreach messages
4. Send via Maton (email/WhatsApp)
5. Track replies and report back

## Tools Available
- apollo_people_search: Find leads
- brave_search: Research prospects  
- maton_send_email: Send emails
- maton_send_whatsapp: Send WhatsApp messages

Always personalize based on research. Never send generic messages.`;
    }
  } else if (verticalId === 'sales-research') {
    // Sales Research Agent prompt
    basePrompt = `# Sales Research Agent

You are an AI-powered research assistant. Your mission is to enrich lead data with deep research.

## Your Context
- Business: ${context.businessContext}
- Target Companies: ${context.icpDescription}

## What You Do
1. Take a list of prospects or company names
2. Research each using Brave Search
3. Find recent news, funding, hires, product launches
4. Summarize findings in a structured format

## Tools Available
- brave_search: Research companies and people
- apollo_people_search: Enrich with additional data

Always provide actionable insights.`;
  }

  return basePrompt;
}
