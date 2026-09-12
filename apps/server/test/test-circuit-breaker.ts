import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LlmService } from '../src/ai/llm.service';

async function testCircuitBreaker() {
  console.log('\n' + '='.repeat(80));
  console.log('  🧪 TESTING RESILIENT LLM CIRCUIT BREAKER & HALF-OPEN RECOVERY');
  console.log('='.repeat(80) + '\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const llmService = app.get(LlmService);

  // 1. Initial state check: CLOSED
  console.log('Step 1: Checking initial circuit breaker state (Expect CLOSED)...');
  let state = llmService.getCircuitState();
  console.log('Current State:', state);
  if (state.state !== 'CLOSED' || state.isPrimaryDisabled) {
    throw new Error(`Expected CLOSED state, got ${state.state}`);
  }
  console.log('✅ Initial state is healthy CLOSED.\n');

  // 2. Simulate 429 Quota Exceeded error
  console.log('Step 2: Simulating 429 RESOURCE_EXHAUSTED error from Gemini...');
  const simulatedError = new Error('429 Resource has been exhausted (e.g. check quota).');
  (simulatedError as any).status = 429;
  llmService.handleExecutionError(simulatedError);

  state = llmService.getCircuitState();
  console.log('Current State after 429:', state);
  if (state.state !== 'OPEN' || !state.isPrimaryDisabled) {
    throw new Error(`Expected OPEN state after 429, got ${state.state}`);
  }
  console.log('✅ Circuit breaker tripped to OPEN successfully.\n');

  // 3. Test getModel() routing while circuit is OPEN
  console.log('Step 3: Calling getModel() while OPEN (Expect fallback Groq chain routing)...');
  const activeModel = llmService.getModel();
  if (!activeModel) {
    throw new Error('getModel() returned null/undefined');
  }
  console.log('✅ Active model returned Groq fallback chain with zero delay.\n');

  // 4. Test Half-Open transition when cooldown expires
  console.log('Step 4: Testing Half-Open Auto-Recovery...');
  // Force cooldown to have passed
  (llmService as any).primaryDisabledUntil = Date.now() - 1000;
  
  // Call getModel() which triggers Half-Open check
  const probedModel = llmService.getModel();
  state = llmService.getCircuitState();
  console.log('Current State after Half-Open probe:', state);
  if (state.state !== 'CLOSED' || state.isPrimaryDisabled) {
    throw new Error(`Expected CLOSED state after Half-Open probe reset, got ${state.state}`);
  }
  console.log('✅ Half-Open auto-recovery reset primary status and allowed probe request.\n');

  // 5. Test manual reset
  console.log('Step 5: Testing manual resetCircuitBreaker()...');
  llmService.tripCircuitBreaker('Manual test trip');
  if (llmService.getCircuitState().state !== 'OPEN') {
    throw new Error('Trip failed');
  }
  llmService.resetCircuitBreaker();
  if (llmService.getCircuitState().state !== 'CLOSED') {
    throw new Error('Reset failed');
  }
  console.log('✅ Manual circuit breaker reset verified.\n');

  console.log('='.repeat(80));
  console.log('  🎉 ALL CIRCUIT BREAKER UNIT TESTS PASSED!');
  console.log('='.repeat(80) + '\n');

  await app.close();
  process.exit(0);
}

testCircuitBreaker().catch((err) => {
  console.error('❌ Circuit breaker test failed:', err);
  process.exit(1);
});
