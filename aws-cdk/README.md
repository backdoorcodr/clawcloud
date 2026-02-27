# OpenClaw AWS CDK Infrastructure

Complete multi-tenant OpenClaw hosting platform on AWS using CDK.

## Architecture

This deployment creates:

- **OpenclawStack** (46 resources):
  - VPC with public/private subnets across 2 AZs
  - ECS Fargate cluster
  - EFS filesystem for persistent user storage
  - Application Load Balancer with **3600s idle timeout** (fixes WebSocket disconnects)
  - Amazon Cognito User Pool for authentication
  - DynamoDB table for instance tracking
  - IAM roles with least-privilege permissions
  - Next.js Portal service on Fargate
  
- **UserStack** (7 resources):
  - Gateway task definition template
  - Security groups
  - IAM policies for EFS access

## Quick Start

### 1. Prerequisites

```bash
npm install -g aws-cdk
aws configure  # Set up AWS credentials
```

### 2. Build Gateway Image

```bash
# From repo root
docker build -t openclaw/gateway .

# Push to ECR
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=eu-west-1

aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker tag openclaw/gateway:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/openclaw/gateway:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/openclaw/gateway:latest
```

### 3. Deploy Infrastructure

```bash
cd infra/aws-cdk

# Set gateway image URI
export ECR_IMAGE_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/openclaw/gateway:latest

# Install dependencies
npm install

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy
cdk deploy --all
```

### 4. Build and Push Portal Image

```bash
cd infra/portal

docker build -t openclaw/portal .

docker tag openclaw/portal:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/openclaw/portal:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/openclaw/portal:latest
```

### 5. Access Portal

After deployment, get the Portal URL from CloudFormation outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name OpenclawStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PortalURL`].OutputValue' \
  --output text
```

## Testing

### CDK Smoke Test

Validates that all stacks can synthesize without errors:

```bash
npm run smoke-test
# or
npx tsx smoke-test.ts
```

Expected output:
```
✅ All CDK smoke tests passed!
📦 Generated 2 CloudFormation stacks:
  - TestOpenclawStack: 46 resources
  - TestUserStack: 7 resources
```

## Stack Structure

### OpenclawStack (`lib/openclaw-stack.ts`)

Merged stack containing foundation infrastructure + portal service. This design avoids cyclic dependencies between the portal and the ALB it registers with.

Exports:
- `vpc` - VPC for user gateway tasks
- `cluster` - ECS cluster
- `efsFileSystem` - Shared EFS for user data
- `portalUrl` - Portal access URL

### UserStack (`lib/user-stack.ts`)

Template task definition for OpenClaw gateway instances. The portal uses this to launch on-demand tasks via ECS RunTask API.

Exports:
- `gatewayTaskDefinition` - Task definition ARN
- `gatewaySecurityGroup` - Security group for gateway tasks

## Entry Points

- `bin/openclaw-new.ts` - Main CDK app entry point
- `bin/openclaw.ts` - Original (kept for reference, not used)

## Portal Application

See `../portal/README.md` for portal app details.

API routes:
- `POST /api/instance/launch` - Launch new gateway instance
- `GET /api/instance/status` - Poll instance health
- `GET /api/instance/info` - Get access URL and token
- `GET /api/health` - Health check for ALB

## Cost Estimates

Approximate monthly costs (eu-west-1):

- VPC (NAT Gateway): ~$32
- ALB: ~$16 + LCU charges
- ECS Fargate:
  - Portal (0.5 vCPU, 1GB): ~$17
  - Per gateway (2 vCPU, 4GB): ~$70 when running
- EFS: $0.30/GB-month (storage only)
- DynamoDB: Pay-per-request (~$0 for low traffic)
- Cognito: Free tier (50K MAU)

**Total base**: ~$65-80/month + per-user gateway costs

## Cleanup

```bash
cdk destroy --all --force
```

**Note**: This does NOT delete:
- ECR images (delete manually via console/CLI)
- EFS data (delete via console/CLI)
- Secrets Manager secrets (soft-deleted, recoverable for 7-30 days)

## Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment guide
- [Portal README](../portal/README.md) - Portal application details

## Troubleshooting

### Cyclic Dependency Error

If you see cyclic dependency errors during synthesis, ensure you're using the merged `OpenclawStack` (not separate `FoundationStack` + `PortalStack`).

### Portal Not Accessible

Check ECS service status:
```bash
aws ecs describe-services \
  --cluster openclaw-hosted \
  --services PortalService
```

Check ALB target health:
```bash
aws elbv2 describe-target-health \
  --target-group-arn <portal-target-group-arn>
```

### Gateway Instance Won't Start

Check CloudWatch Logs:
```bash
aws logs tail /ecs/openclaw-gateway --follow
```

Verify secrets exist:
```bash
aws secretsmanager list-secrets \
  --filters Key=name,Values=openclaw/users/
```

## Security

- All secrets stored in AWS Secrets Manager (encrypted at rest)
- EFS data encrypted in transit (TLS)
- Per-user isolation via EFS access points
- IAM roles follow principle of least privilege
- Cognito provides authentication (JWT tokens)
- Gateway tokens are randomly generated UUIDs
