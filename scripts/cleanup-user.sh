#!/bin/bash
set -e

# Cleanup script for OpenClaw user resources
# Usage: ./cleanup-user.sh <user-email>

if [ $# -eq 0 ]; then
  echo "Usage: $0 <user-email>"
  echo "Example: $0 user@example.com"
  exit 1
fi

USER_EMAIL="$1"
REGION="${AWS_REGION:-eu-west-1}"
USER_POOL_ID="${COGNITO_USER_POOL_ID:-eu-west-1_q63BxFI4I}"
TABLE_NAME="${DYNAMODB_TABLE_NAME:-openclaw-instances}"
CLUSTER_NAME="${ECS_CLUSTER_NAME:-openclaw-hosted}"
EFS_ID="${EFS_FILE_SYSTEM_ID}"

echo "🔍 Looking up user: $USER_EMAIL"

# 1. Get Cognito user ID (sub)
USER_ID=$(aws cognito-idp list-users \
  --user-pool-id "$USER_POOL_ID" \
  --filter "email = \"$USER_EMAIL\"" \
  --region "$REGION" \
  --query 'Users[0].Username' \
  --output text)

if [ "$USER_ID" = "None" ] || [ -z "$USER_ID" ]; then
  echo "❌ User not found in Cognito: $USER_EMAIL"
  exit 1
fi

echo "✅ Found user ID: $USER_ID"

# 2. Get instance data from DynamoDB
echo "🔍 Fetching instance data from DynamoDB..."
INSTANCE_DATA=$(aws dynamodb get-item \
  --table-name "$TABLE_NAME" \
  --key "{\"userId\": {\"S\": \"$USER_ID\"}}" \
  --region "$REGION" \
  --output json 2>/dev/null || echo "{}")

TASK_ARN=$(echo "$INSTANCE_DATA" | jq -r '.Item.taskArn.S // empty')
ACCESS_POINT_ID=$(echo "$INSTANCE_DATA" | jq -r '.Item.accessPointId.S // empty')

# 3. Stop ECS task if exists
if [ -n "$TASK_ARN" ]; then
  echo "🛑 Stopping ECS task: $TASK_ARN"
  aws ecs stop-task \
    --cluster "$CLUSTER_NAME" \
    --task "$TASK_ARN" \
    --region "$REGION" \
    --output json > /dev/null 2>&1 || echo "⚠️  Task may already be stopped"
  echo "✅ Task stop initiated"
else
  echo "ℹ️  No running task found"
fi

# 4. Delete EFS access point if exists
if [ -n "$ACCESS_POINT_ID" ]; then
  echo "🗑️  Deleting EFS access point: $ACCESS_POINT_ID"
  aws efs delete-access-point \
    --access-point-id "$ACCESS_POINT_ID" \
    --region "$REGION" 2>/dev/null || echo "⚠️  Access point may already be deleted"
  echo "✅ EFS access point deleted"
else
  echo "ℹ️  No EFS access point found"
fi

# 5. Delete Secrets Manager secret
SECRET_NAME="openclaw/users/$USER_ID/keys"
echo "🗑️  Deleting secret: $SECRET_NAME"
aws secretsmanager delete-secret \
  --secret-id "$SECRET_NAME" \
  --force-delete-without-recovery \
  --region "$REGION" 2>/dev/null || echo "⚠️  Secret may not exist or already deleted"
echo "✅ Secret deleted"

# 6. Delete DynamoDB record
echo "🗑️  Deleting DynamoDB record for user: $USER_ID"
aws dynamodb delete-item \
  --table-name "$TABLE_NAME" \
  --key "{\"userId\": {\"S\": \"$USER_ID\"}}" \
  --region "$REGION"
echo "✅ DynamoDB record deleted"

echo ""
echo "✨ Cleanup complete for $USER_EMAIL (ID: $USER_ID)"
echo "Summary:"
echo "  - ECS task: ${TASK_ARN:-N/A}"
echo "  - EFS access point: ${ACCESS_POINT_ID:-N/A}"
echo "  - Secret: $SECRET_NAME"
echo "  - DynamoDB record: deleted"
echo ""
echo "The user can now launch a fresh gateway instance."
