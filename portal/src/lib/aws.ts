import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ECSClient, RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { EFSClient, CreateAccessPointCommand, DescribeAccessPointsCommand } from '@aws-sdk/client-efs';
import { SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { EC2Client, DescribeNetworkInterfacesCommand } from '@aws-sdk/client-ec2';
const region = process.env.AWS_REGION || 'eu-west-1';
export const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
export const ecs = new ECSClient({ region });
export const efs = new EFSClient({ region });
export const secretsManager = new SecretsManagerClient({ region });
export const ec2 = new EC2Client({ region });
export interface UserInstance {
  userId: string;
  taskArn?: string;
  gatewayToken?: string;
  gatewayUrl?: string;
  status: 'starting' | 'running' | 'healthy' | 'stopped' | 'failed';
  createdAt: number;
  lastUpdated: number;
  accessPointId?: string;
  // Vertical & billing fields
  vertical?: string;
  plan?: string;
  creditsLimit?: number;
  creditsUsed?: number;
}
export async function saveUserInstance(instance: UserInstance) {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  await dynamodb.send(new PutCommand({
    TableName: tableName,
    Item: instance,
  }));
}
export async function getUserInstance(userId: string): Promise<UserInstance | null> {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  const result = await dynamodb.send(new GetCommand({
    TableName: tableName,
    Key: { userId },
  }));
  return result.Item as UserInstance | null;
}
export async function updateUserInstance(userId: string, updates: Partial<UserInstance>) {
  const tableName = process.env.DYNAMODB_TABLE_NAME!;
  const updateExpression = Object.keys(updates)
    .map((key, i) => `#attr${i} = :val${i}`)
    .join(', ');
  const expressionAttributeNames = Object.keys(updates).reduce((acc, key, i) => {
    acc[`#attr${i}`] = key;
    return acc;
  }, {} as Record<string, string>);
  const expressionAttributeValues = Object.values(updates).reduce((acc, val, i) => {
    acc[`:val${i}`] = val;
    return acc;
  }, {} as Record<string, any>);
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: { userId },
    UpdateExpression: `SET ${updateExpression}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}
export async function createEFSAccessPoint(userId: string): Promise<string> {
  const fileSystemId = process.env.EFS_FILE_SYSTEM_ID!;
  
  // Check if access point already exists
  const existing = await efs.send(new DescribeAccessPointsCommand({
    FileSystemId: fileSystemId,
  }));
  
  const existingAp = existing.AccessPoints?.find(ap => 
    ap.RootDirectory?.Path === `/users/${userId}`
  );
  
  if (existingAp?.AccessPointId) {
    return existingAp.AccessPointId;
  }
  // Create new access point
  const result = await efs.send(new CreateAccessPointCommand({
    FileSystemId: fileSystemId,
    PosixUser: {
      Uid: 1000,
      Gid: 1000,
    },
    RootDirectory: {
      Path: `/users/${userId}`,
      CreationInfo: {
        OwnerUid: 1000,
        OwnerGid: 1000,
        Permissions: '755',
      },
    },
    Tags: [
      { Key: 'Name', Value: `openclaw-user-${userId}` },
      { Key: 'UserId', Value: userId },
    ],
  }));
  return result.AccessPointId!;
}
export async function storeUserSecrets(userId: string, secrets: Record<string, string>) {
  const secretName = `openclaw/users/${userId}/keys`;
  
  try {
    // Try to create the secret
    await secretsManager.send(new CreateSecretCommand({
      Name: secretName,
      SecretString: JSON.stringify(secrets),
      Tags: [
        { Key: 'UserId', Value: userId },
      ],
    }));
  } catch (error: any) {
    // If secret already exists, update it
    if (error.name === 'ResourceExistsException') {
      await secretsManager.send(new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: JSON.stringify(secrets),
      }));
    } else {
      throw error;
    }
  }
}
export interface LaunchInstanceParams {
  userId: string;
  secrets: Record<string, string>;
  gatewayToken: string;
  // Vertical-specific fields (optional for legacy launches)
  vertical?: string;
  plan?: string;
  creditsLimit?: number;
  systemPrompt?: string;
}
export async function launchGatewayTask(params: LaunchInstanceParams): Promise<string> {
  const { userId, secrets, gatewayToken } = params;
  
  // Create EFS access point
  const accessPointId = await createEFSAccessPoint(userId);
  
  // Store secrets
  await storeUserSecrets(userId, secrets);
  
  // Launch ECS task in PUBLIC subnet with public IP
  const clusterArn = process.env.ECS_CLUSTER_ARN!;
  const taskDefinitionArn = process.env.GATEWAY_TASK_DEFINITION_ARN!;
  const securityGroupId = process.env.GATEWAY_SECURITY_GROUP_ID!;
  const publicSubnetIds = process.env.PUBLIC_SUBNET_IDS!.split(',');
  const result = await ecs.send(new RunTaskCommand({
    cluster: clusterArn,
    taskDefinition: taskDefinitionArn,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: publicSubnetIds,
        securityGroups: [securityGroupId],
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: 'Container',
          command: [
            '/bin/sh',
            '-c',
            'if [ -n "$OPENROUTER_API_KEY" ]; then node openclaw.mjs onboard --non-interactive --accept-risk --auth-choice openrouter-api-key --openrouter-api-key "$OPENROUTER_API_KEY" --skip-daemon --skip-ui --skip-health --skip-channels --gateway-port 18789 --gateway-auth token --gateway-token "$OPENCLAW_GATEWAY_TOKEN" && node openclaw.mjs config set agents.defaults.model.primary openrouter/minimax/minimax-m2.5; elif [ -n "$ANTHROPIC_API_KEY" ]; then node openclaw.mjs onboard --non-interactive --accept-risk --auth-choice anthropic --anthropic-api-key "$ANTHROPIC_API_KEY" --skip-daemon --skip-ui --skip-health --skip-channels --gateway-port 18789 --gateway-auth token --gateway-token "$OPENCLAW_GATEWAY_TOKEN"; elif [ -n "$OPENAI_API_KEY" ]; then node openclaw.mjs onboard --non-interactive --accept-risk --auth-choice openai-api-key --openai-api-key "$OPENAI_API_KEY" --skip-daemon --skip-ui --skip-health --skip-channels --gateway-port 18789 --gateway-auth token --gateway-token "$OPENCLAW_GATEWAY_TOKEN" && node openclaw.mjs config set agents.defaults.model.primary openai/gpt-4o; fi && npx clawhub install maton-agent-tools --force && npx clawhub install brave-search --force && node openclaw.mjs config set env.vars.MATON_API_KEY "$MATON_API_KEY" && node openclaw.mjs config set env.vars.APOLLO_API_KEY "$APOLLO_API_KEY" && node openclaw.mjs config set env.vars.BRAVE_API_KEY "$BRAVE_API_KEY" && node openclaw.mjs config set gateway.mode local && node openclaw.mjs config set gateway.controlUi.dangerouslyDisableDeviceAuth true && node openclaw.mjs gateway run --bind lan --port 18789',
          ],
          environment: [
            { name: 'HOME', value: '/home/node' },
            { name: 'TERM', value: 'xterm-256color' },
            { name: 'OPENCLAW_GATEWAY_TOKEN', value: gatewayToken },
            { name: 'OPENCLAW_GATEWAY_CONTROL_UI_BASE_PATH', value: `/u/${userId}` },
            { name: 'OPENCLAW_GATEWAY_IDLE_TIMEOUT_SECONDS', value: '300' },
            { name: 'BRAVE_API_KEY', value: process.env.BRAVE_API_KEY ?? '' },
            ...Object.entries(secrets).map(([key, value]) => ({ name: key, value })),
          ],
        },
      ],
    },
    tags: [
      { key: 'UserId', value: userId },
      { key: 'Type', value: 'openclaw-gateway' },
    ],
  }));
  if (!result.tasks?.[0]?.taskArn) {
    throw new Error('Failed to launch task');
  }
  const taskArn = result.tasks[0].taskArn;
  // Wait for task to reach RUNNING state and get public IP
  let publicIp: string | undefined;
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const describeResult = await ecs.send(new DescribeTasksCommand({
      cluster: clusterArn,
      tasks: [taskArn],
    }));
    const task = describeResult.tasks?.[0];
    if (task?.lastStatus === 'RUNNING') {
      // Extract ENI ID from task attachments
      const eni = task.attachments?.find((a: any) => a.type === 'ElasticNetworkInterface');
      const eniId = eni?.details?.find((d: any) => d.name === 'networkInterfaceId')?.value;
      
      if (eniId) {
        // Get public IP via EC2 DescribeNetworkInterfaces
        try {
          const eniResult = await ec2.send(new DescribeNetworkInterfacesCommand({
            NetworkInterfaceIds: [eniId],
          }));
          
          publicIp = eniResult.NetworkInterfaces?.[0]?.Association?.PublicIp;
        } catch (error) {
          console.error('Failed to get public IP from ENI:', error);
        }
      }
      
      break;
    }
    if (task?.lastStatus === 'STOPPED') {
      throw new Error('Task stopped before reaching RUNNING state');
    }
  }
  if (!publicIp) {
    // Task is running but we couldn't get IP - store anyway, status polling will handle it
    console.warn(`Could not determine public IP for task ${taskArn}`);
  } else {
    // Store gateway URL
    const gatewayUrl = `http://${publicIp}:18789/u/${userId}`;
    await updateUserInstance(userId, { gatewayUrl, lastUpdated: Date.now() });
  }
  return taskArn;
}
export async function getTaskPublicIp(taskArn: string): Promise<string | null> {
  const clusterArn = process.env.ECS_CLUSTER_ARN!;
  
  try {
    const result = await ecs.send(new DescribeTasksCommand({
      cluster: clusterArn,
      tasks: [taskArn],
    }));
    const task = result.tasks?.[0];
    if (!task || task.lastStatus !== 'RUNNING') {
      return null;
    }
    // Extract ENI ID from task attachments
    const eni = task.attachments?.find((a: any) => a.type === 'ElasticNetworkInterface');
    const eniId = eni?.details?.find((d: any) => d.name === 'networkInterfaceId')?.value;
    
    if (!eniId) {
      return null;
    }
    // Get public IP via EC2 DescribeNetworkInterfaces
    const eniResult = await ec2.send(new DescribeNetworkInterfacesCommand({
      NetworkInterfaceIds: [eniId],
    }));
    
    return eniResult.NetworkInterfaces?.[0]?.Association?.PublicIp || null;
  } catch (error) {
    console.error('Failed to get task public IP:', error);
    return null;
  }
}
export async function getTaskStatus(taskArn: string): Promise<'starting' | 'running' | 'healthy' | 'stopped' | 'failed'> {
  const clusterArn = process.env.ECS_CLUSTER_ARN!;
  
  const result = await ecs.send(new DescribeTasksCommand({
    cluster: clusterArn,
    tasks: [taskArn],
  }));
  const task = result.tasks?.[0];
  if (!task) {
    return 'failed';
  }
  if (task.lastStatus === 'STOPPED') {
    return task.stopCode === 'EssentialContainerExited' ? 'failed' : 'stopped';
  }
  if (task.lastStatus === 'RUNNING') {
    // Check if health checks are passing
    const healthStatus = task.containers?.[0]?.healthStatus;
    if (healthStatus === 'HEALTHY') {
      return 'healthy';
    }
    return 'running';
  }
  return 'starting';
}
