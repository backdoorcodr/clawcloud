# OpenClaw AWS Provisioning Portal - Deployment Guide

## Architecture Overview

This deployment creates a multi-tenant OpenClaw provisioning system on AWS with:

1. **Foundation Infrastructure** (`foundation-stack.ts`)
   - VPC with public/private subnets across 2 AZs
   - ECS Fargate cluster
   - EFS filesystem for persistent user storage
   - Application Load Balancer (ALB) with 3600s idle timeout
   - Amazon Cognito for user authentication
   - DynamoDB table for instance tracking
   - IAM roles for portal and gateway tasks

2. **Portal Service** (`portal-stack.ts`)
   - Next.js web application running on Fargate
   - Handles user signup/login via Cognito
   - Collects API keys (LLM provider + Apollo + Maton)
   - Launches on-demand OpenClaw gateway instances per user
   - Provides status monitoring and access links

3. **Gateway Task Definition** (`user-stack.ts`)
   - Fargate task definition for OpenClaw gateway
   - Per-user EFS access points for data isolation
   - Security groups and IAM roles
   - Target group for ALB routing

## User Flow

1. **Sign Up**: User creates account via Cognito (email + password)
2. **Login**: User signs in with credentials
3. **API Keys Form**: User provides:
   - One of: `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, or `OPENAI_API_KEY` (required)
   - `APOLLO_API_KEY` (required)
   - `MATON_API_KEY` (required for Matonai service)
4. **Launch**: Portal creates EFS access point, stores secrets in AWS Secrets Manager, launches ECS task
5. **Wait**: Portal polls ECS task status until healthy
6. **Access**: User gets link: `http://<alb-dns>/u/<user-id>/?token=<gateway-token>`

## Prerequisites

1. **AWS Account** with permissions for ECS, EFS, ALB, Cognito, DynamoDB, Secrets Manager
2. **AWS CDK CLI**: `npm install -g aws-cdk`
3. **Docker** for building container images
4. **Node.js 18+** for the portal app

## Deployment Steps

### 1. Bootstrap CDK (first time only)

```bash
cd infra/aws-cdk
cdk bootstrap
```

### 2. Build and Push Gateway Image

```bash
# From repo root
docker build -t openclaw/gateway .

# Tag for ECR
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com

docker tag openclaw/gateway:latest <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/openclaw/gateway:latest
docker push <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/openclaw/gateway:latest
```

### 3. Build and Push Portal Image

```bash
# From infra/portal (will be created)
docker build -t openclaw/portal .

docker tag openclaw/portal:latest <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/openclaw/portal:latest
docker push <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/openclaw/portal:latest
```

### 4. Deploy Infrastructure

```bash
cd infra/aws-cdk

# Set environment
export ECR_IMAGE_URI=<ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/openclaw/gateway:latest

# Deploy all stacks
npm install
npm run build
cdk deploy --all --require-approval never
```

### 5. Get Portal URL

After deployment completes, find the ALB DNS name in the outputs:

```
Outputs:
FoundationStack.ALBDNSName = openclaw-hosted-<ID>.eu-west-1.elb.amazonaws.com
PortalStack.PortalURL = http://openclaw-hosted-<ID>.eu-west-1.elb.amazonaws.com
```

## Architecture Components

### Cognito User Pool
- Email-based sign-in
- Password requirements: 8+ chars, uppercase, lowercase, digits
- Self-sign-up enabled with email verification

### DynamoDB Table: `openclaw-instances`
Schema:
```
{
  userId: string (partition key)
  taskArn: string
  gatewayToken: string
  status: string ("starting" | "running" | "healthy")
  createdAt: number
  lastUpdated: number
}
```

### Secrets Manager
Per-user secrets stored at: `openclaw/users/<userId>/keys`
```json
{
  "ANTHROPIC_API_KEY": "sk-ant-...",
  "OPENROUTER_API_KEY": "sk-or-...",
  "OPENAI_API_KEY": "sk-...",
  "APOLLO_API_KEY": "...",
  "MATON_API_KEY": "..."
}
```

### EFS Structure
```
/users/
  /<userId>/           (EFS access point per user)
    .openclaw/        (OpenClaw config and data)
```

## Portal API Routes

- `POST /api/instance/launch` - Create new instance for user
- `GET /api/instance/status` - Poll instance health
- `GET /api/instance/info` - Get access URL and token
- `GET /api/health` - Health check for ALB

## Security

- All secrets stored in AWS Secrets Manager (encrypted at rest)
- EFS data encrypted in transit (TLS)
- Per-user isolation via EFS access points
- IAM roles follow principle of least privilege
- Cognito provides auth (JWT tokens)
- Gateway tokens are randomly generated UUIDs

## Costs (Approximate Monthly)

- **VPC**: ~$32/month (NAT Gateway)
- **ALB**: ~$16/month + $0.008/LCU-hour
- **ECS Fargate**: $0.04048/vCPU-hour + $0.004445/GB-hour
  - Portal (0.5 vCPU, 1GB): ~$17/month
  - Per gateway (2 vCPU, 4GB): ~$70/month (when running)
- **EFS**: $0.30/GB-month (storage only, elastic throughput)
- **DynamoDB**: Pay-per-request (~$0 for low traffic)
- **Cognito**: Free tier 50K MAU

## Troubleshooting

### Portal not accessible
- Check ECS service is running: `aws ecs describe-services --cluster openclaw-hosted --services PortalService`
- Check ALB target health: AWS Console → EC2 → Target Groups

### Gateway instance won't start
- Check CloudWatch Logs: `/ecs/openclaw-<userId>`
- Verify secrets exist: `aws secretsmanager get-secret-value --secret-id openclaw/users/<userId>/keys`
- Check EFS access point: `aws efs describe-access-points --file-system-id <fs-id>`

### WebSocket disconnects (1006)
- ALB idle timeout is set to 3600s (already fixed)
- Check `OPENCLAW_GATEWAY_ALLOWED_ORIGINS` includes ALB DNS name

## Cleanup

```bash
cd infra/aws-cdk
cdk destroy --all --force
```

**Note**: This does NOT delete:
- ECR images (manual: `aws ecr delete-repository --repository-name openclaw/gateway --force`)
- EFS data (manual: delete via console or CLI)
- Secrets Manager secrets (soft-deleted, recoverable for 7-30 days)

## Next Steps (Option B - Production UI)

1. Improve portal UI (Tailwind CSS, better UX)
2. Add user dashboard (show running instances, usage stats)
3. Add instance stop/restart controls
4. Add billing/metering
5. Add custom domains (Route53 + ACM certificates)
6. Add HTTPS (ALB + ACM)
7. Add monitoring/alerts (CloudWatch)
8. Add auto-scaling for high traffic
