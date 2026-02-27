import { NextRequest, NextResponse } from 'next/server';
import { getUserInstance, getTaskStatus, getTaskPublicIp, updateUserInstance } from '@/lib/aws';

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
        status: 'not-found',
        message: 'No instance found for this user'
      });
    }

    // If we have a task ARN, check ECS status
    if (instance.taskArn) {
      const status = await getTaskStatus(instance.taskArn);
      
      // Self-healing: if task is running/healthy and gatewayUrl is missing, fetch and store it
      let { gatewayUrl } = instance;
      if (!gatewayUrl && (status === 'running' || status === 'healthy')) {
        const publicIp = await getTaskPublicIp(instance.taskArn);
        if (publicIp) {
          gatewayUrl = `http://${publicIp}:18789/u/${userId}`;
          await updateUserInstance(userId, {
            gatewayUrl,
            lastUpdated: Date.now(),
          });
        }
      }
      
      // Update DynamoDB if status changed
      if (status !== instance.status) {
        await updateUserInstance(userId, {
          status,
          lastUpdated: Date.now(),
        });
      }

      return NextResponse.json({
        status,
        taskArn: instance.taskArn,
        gatewayUrl,
        createdAt: instance.createdAt,
        lastUpdated: Date.now(),
      });
    }

    return NextResponse.json({
      status: instance.status,
      gatewayUrl: instance.gatewayUrl,
      createdAt: instance.createdAt,
      lastUpdated: instance.lastUpdated,
    });
  } catch (error: any) {
    console.error('Status error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to get status' 
    }, { status: 500 });
  }
}
