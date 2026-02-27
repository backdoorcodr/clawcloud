import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { launchGatewayTask, saveUserInstance } from '@/lib/aws';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Get user ID from Cognito JWT (in production, verify JWT)
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // For demo, extract userId from JWT payload (in production, verify signature)
    const token = authHeader.replace('Bearer ', '');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const userId = payload.sub;

    // Parse request body
    const body = await request.json();
    const { llmKey, llmProvider, apolloKey, matonKey } = body;

    // Validate required keys
    if (!llmKey || !llmProvider || !apolloKey || !matonKey) {
      return NextResponse.json({ 
        error: 'Missing required keys' 
      }, { status: 400 });
    }

    // Map LLM provider to environment variable name
    const llmKeyMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      openai: 'OPENAI_API_KEY',
    };

    const llmEnvKey = llmKeyMap[llmProvider];
    if (!llmEnvKey) {
      return NextResponse.json({ 
        error: 'Invalid LLM provider' 
      }, { status: 400 });
    }

    // Prepare secrets
    const secrets: Record<string, string> = {
      [llmEnvKey]: llmKey,
      APOLLO_API_KEY: apolloKey,
      MATON_API_KEY: matonKey,
    };

    // Generate gateway token
    const gatewayToken = randomUUID();

    // Launch ECS task
    const taskArn = await launchGatewayTask({
      userId,
      secrets,
      gatewayToken,
    });

    // Save to DynamoDB
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
  } catch (error: any) {
    console.error('Launch error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to launch instance' 
    }, { status: 500 });
  }
}
