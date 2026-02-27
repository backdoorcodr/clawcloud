#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { OpenclawStack } from '../lib/openclaw-stack';

const app = new App();

const env = {
  region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

const ecrImageUri = process.env.ECR_IMAGE_URI || '010928201123.dkr.ecr.eu-west-1.amazonaws.com/openclaw/gateway:latest';

// Single stack containing all infrastructure: VPC, ECS, EFS, ALB, Cognito, DynamoDB, IAM, Portal, Gateway
new OpenclawStack(app, 'OpenclawStack', {
  env,
  ecrImageUri,
});

app.synth();
