import { NextRequest, NextResponse } from 'next/server';
import { getUserInstance } from '@/lib/aws';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Get user ID from Cognito JWT
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const userId = payload.sub;

    // Get instance from DynamoDB
    const instance = await getUserInstance(userId);
    if (!instance) {
      return NextResponse.json({ 
        error: 'No instance found'
      }, { status: 404 });
    }

    if (!instance.gatewayToken) {
      return NextResponse.json({ 
        error: 'Instance not ready yet'
      }, { status: 404 });
    }

    // Use gatewayUrl from DynamoDB if available, otherwise fall back to constructing
    const url = instance.gatewayUrl 
      ? `${instance.gatewayUrl}/?token=${instance.gatewayToken}`
      : `http://gateway-not-ready/u/${userId}/?token=${instance.gatewayToken}`;

    return NextResponse.json({
      url,
      userId,
      status: instance.status,
    });
  } catch (error: any) {
    console.error('Info error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to get info' 
    }, { status: 500 });
  }
}
