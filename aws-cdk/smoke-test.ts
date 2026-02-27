#!/usr/bin/env tsx
/**
 * CDK Infrastructure Smoke Test
 * Validates that all CDK stacks can synthesize without errors
 */

import { App } from 'aws-cdk-lib';
import { OpenclawStack } from './lib/openclaw-stack';
import { UserStack } from './lib/user-stack';

async function main() {
  console.log('\n🧪 CDK Infrastructure Smoke Test\n');

  try {
    console.log('Creating CDK app...');
    const app = new App();

    const env = {
      region: 'eu-west-1',
      account: '123456789012', // Dummy account for testing
    };

    const ecrImageUri = 'dummy.dkr.ecr.eu-west-1.amazonaws.com/openclaw/gateway:latest';

    console.log('✅ CDK app created');

    // Test OpenclawStack (merged foundation + portal)
    console.log('Testing OpenclawStack...');
    const openclaw = new OpenclawStack(app, 'TestOpenclawStack', {
      env,
      ecrImageUri,
    });
    console.log('✅ OpenclawStack created');

    // Test UserStack
    console.log('Testing UserStack...');
    const userStack = new UserStack(app, 'TestUserStack', {
      env,
      vpc: openclaw.vpc,
      efsFileSystem: openclaw.efsFileSystem,
      ecrImageUri,
    });
    console.log('✅ UserStack created');

    // Synthesize
    console.log('Synthesizing CloudFormation templates...');
    const assembly = app.synth();
    console.log('✅ Synthesis complete');

    // Validate stacks
    const stacks = assembly.stacks;
    console.log(`\n📦 Generated ${stacks.length} CloudFormation stacks:`);
    for (const stack of stacks) {
      const resourceCount = Object.keys(stack.template.Resources || {}).length;
      console.log(`  - ${stack.stackName}: ${resourceCount} resources`);
    }

    console.log('\n✅ All CDK smoke tests passed!\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ CDK smoke test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
