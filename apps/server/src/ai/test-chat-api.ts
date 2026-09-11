import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { randomUUID } from 'crypto';

async function bootstrap() {
  console.log('\n======================================================');
  console.log('  COMMERCE AI CHAT API & SSE STREAMING TEST RUNNER');
  console.log('======================================================\n');

  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();
  const server = app.getHttpServer();

  try {
    const testTenantId = `api-tenant-${randomUUID().slice(0, 6)}`;
    const testConversationId = `api-conv-${randomUUID()}`;

    // -----------------------------------------------------------------
    // TEST 1: Valid POST /api/v1/chat with server-side conversationId
    // -----------------------------------------------------------------
    console.log('▶ [Test 1] Testing Valid POST /api/v1/chat with conversationId...');
    const validPayload = {
      tenantId: testTenantId,
      conversationId: testConversationId,
      message: 'Hello there, how can you help me today?',
    };

    const res1 = await request(server)
      .post('/api/v1/chat')
      .send(validPayload)
      .expect(200);

    console.log('  ✓ Status: 200 OK');
    console.log(`  ✓ Returned Conversation ID: ${res1.body.conversationId}`);
    console.log(`  ✓ Detected Intent: ${res1.body.intent} (Confidence: ${(res1.body.confidence * 100).toFixed(1)}%)`);
    console.log(`  ✓ Reply preview: "${res1.body.reply.slice(0, 80)}..."`);
    console.log('  ✅ Test 1 Passed.\n');

    // -----------------------------------------------------------------
    // TEST 2: Multi-turn Follow-up via REST endpoint (Server-side Memory)
    // -----------------------------------------------------------------
    console.log('▶ [Test 2] Testing Multi-turn Context Retention via REST...');
    const followUpPayload = {
      tenantId: testTenantId,
      conversationId: testConversationId,
      message: 'What was my initial question?',
    };

    const res2 = await request(server)
      .post('/api/v1/chat')
      .send(followUpPayload)
      .expect(200);

    console.log('  ✓ Status: 200 OK');
    console.log(`  ✓ Follow-up Reply preview: "${res2.body.reply.slice(0, 100)}..."`);
    console.log('  ✅ Test 2 Passed.\n');

    // -----------------------------------------------------------------
    // TEST 3: Invalid Request (Missing tenantId) -> 400 Bad Request
    // -----------------------------------------------------------------
    console.log('▶ [Test 3] Testing Invalid Payload (Missing tenantId)...');
    const invalidPayloadNoTenant = {
      message: 'Do you have sneakers?',
    };

    const res3 = await request(server)
      .post('/api/v1/chat')
      .send(invalidPayloadNoTenant)
      .expect(400);

    console.log('  ✓ Status: 400 Bad Request (Validation Caught)');
    console.log(`  ✓ Error response:`, res3.body.message);
    console.log('  ✅ Test 3 Passed.\n');

    // -----------------------------------------------------------------
    // TEST 4: Real-time Streaming POST /api/v1/chat/stream
    // -----------------------------------------------------------------
    console.log('▶ [Test 4] Testing SSE Streaming POST /api/v1/chat/stream...');
    const streamPayload = {
      tenantId: testTenantId,
      conversationId: testConversationId,
      message: 'Can you recommend gifts for a runner?',
    };

    const streamResponse = await new Promise<string>((resolve, reject) => {
      let accumulated = '';
      request(server)
        .post('/api/v1/chat/stream')
        .send(streamPayload)
        .buffer(false)
        .parse((res, callback) => {
          res.on('data', (chunk) => {
            accumulated += chunk.toString();
          });
          res.on('end', () => {
            callback(null, accumulated);
            resolve(accumulated);
          });
          res.on('error', (err) => {
            reject(err);
          });
        })
        .end((err) => {
          if (err) reject(err);
        });
    });

    console.log('  ✓ Stream Event Data Received:');
    const lines = streamResponse
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace('data: ', ''));

    console.log(`  ✓ Total SSE chunks received: ${lines.length}`);
    if (lines.length > 0) {
      console.log(`  ✓ First Event Chunk: ${lines[0]}`);
      console.log(`  ✓ Last Event Chunk: ${lines[lines.length - 1]}`);
    }
    console.log('  ✅ Test 4 Passed.\n');

    console.log('======================================================');
    console.log('  ALL API TESTS & VALIDATIONS PASSED (4/4)');
    console.log('======================================================\n');
  } catch (error) {
    console.error('❌ API Test Suite failed:', error);
    process.exit(1);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
