#!/usr/bin/env tsx
/**
 * Smoke test for OpenClaw Portal API
 * Tests all API endpoints without requiring full Cognito auth
 */

const PORTAL_URL = process.env.PORTAL_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true, message: 'OK' });
    console.log(`✅ ${name}`);
  } catch (error: any) {
    results.push({ name, passed: false, message: error.message });
    console.error(`❌ ${name}: ${error.message}`);
  }
}

async function main() {
  console.log(`\n🧪 OpenClaw Portal Smoke Tests`);
  console.log(`Portal URL: ${PORTAL_URL}\n`);

  // Test 1: Health check
  await test('Health check endpoint', async () => {
    const res = await fetch(`${PORTAL_URL}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error('Health check failed');
  });

  // Test 2: Home page loads
  await test('Home page loads', async () => {
    const res = await fetch(PORTAL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (!html.includes('OpenClaw')) throw new Error('Missing OpenClaw content');
  });

  // Test 3: Launch endpoint (should reject without auth)
  await test('Launch endpoint requires auth', async () => {
    const res = await fetch(`${PORTAL_URL}/api/instance/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llmProvider: 'anthropic',
        llmKey: 'test',
        apolloKey: 'test',
        matonKey: 'test',
      }),
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // Test 4: Status endpoint (should reject without auth)
  await test('Status endpoint requires auth', async () => {
    const res = await fetch(`${PORTAL_URL}/api/instance/status`);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // Test 5: Info endpoint (should reject without auth)
  await test('Info endpoint requires auth', async () => {
    const res = await fetch(`${PORTAL_URL}/api/instance/info`);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\n📊 Results: ${passed}/${total} tests passed\n`);

  if (passed < total) {
    console.error('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
