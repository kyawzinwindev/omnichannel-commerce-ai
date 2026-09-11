import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/redis/redis.service';

async function runMemoryTests() {
  console.log('\n===============================================================');
  console.log('  COMMERCE AI CHATBOT - CONVERSATION MEMORY & ISOLATION TESTS');
  console.log('===============================================================\n');

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
  const prisma = app.get(PrismaService);
  const redisService = app.get(RedisService);

  const tenantId = 'tenant-test';
  const conv101 = 'test-memory-101';
  const conv999 = 'test-memory-999';
  const conv202 = 'test-stream-202';

  let passedTests = 0;
  let totalTests = 0;

  const assertCondition = (name: string, condition: boolean, details?: string) => {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ [PASS] ${name}`);
      if (details) console.log(`     ↳ ${details}`);
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      if (details) console.error(`     ↳ ${details}`);
    }
  };

  try {
    // Ensure tenant exists and clean up previous test conversations
    await prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: { id: tenantId, name: 'Memory Test Store' },
    });

    await prisma.message.deleteMany({
      where: { conversationId: { in: [conv101, conv999, conv202] } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: [conv101, conv999, conv202] } },
    });
    await redisService.del(`chat:history:${tenantId}:${conv101}`);
    await redisService.del(`chat:history:${tenantId}:${conv999}`);
    await redisService.del(`chat:history:${tenantId}:${conv202}`);

    // =========================================================================
    // SCENARIO 1: Multi-Turn Context Retention (Standard REST Endpoint)
    // =========================================================================
    console.log('---------------------------------------------------------------');
    console.log('▶ [SCENARIO 1] Multi-Turn Context Retention (POST /api/v1/chat)');
    console.log('---------------------------------------------------------------');

    // Turn 1: Initial Context Setting
    console.log('\n[Turn 1] Initial Context Setting');
    console.log('  User: "My name is Alex and I am looking for blue running shoes."');
    const res1 = await request(server)
      .post('/api/v1/chat')
      .send({
        tenantId,
        conversationId: conv101,
        message: 'My name is Alex and I am looking for blue running shoes.',
      })
      .expect(200);

    console.log(`  AI Reply: "${res1.body.reply.slice(0, 120)}..."`);
    assertCondition(
      'Turn 1 Response Received',
      Boolean(res1.body.reply && res1.body.conversationId === conv101),
      `Conversation ID: ${res1.body.conversationId}`,
    );

    // Turn 2: Implicit Memory Recall
    console.log('\n[Turn 2] Implicit Memory Recall');
    console.log('  User: "What was my name again, and what product color was I looking for?"');
    const res2 = await request(server)
      .post('/api/v1/chat')
      .send({
        tenantId,
        conversationId: conv101,
        message: 'What was my name again, and what product color was I looking for?',
      })
      .expect(200);

    const reply2 = res2.body.reply || '';
    console.log(`  AI Reply: "${reply2}"`);
    const recallsAlex = /alex/i.test(reply2);
    const recallsBlue = /blue/i.test(reply2);
    assertCondition(
      'Turn 2 Recalls User Name ("Alex")',
      recallsAlex,
      `Found "Alex" in reply: ${recallsAlex}`,
    );
    assertCondition(
      'Turn 2 Recalls Product Color ("blue")',
      recallsBlue,
      `Found "blue" in reply: ${recallsBlue}`,
    );

    // Turn 3: Sequential Context & Follow-up
    console.log('\n[Turn 3] Sequential Context & Follow-up');
    console.log('  User: "How much was the first option you recommended?"');
    const res3 = await request(server)
      .post('/api/v1/chat')
      .send({
        tenantId,
        conversationId: conv101,
        message: 'How much was the first option you recommended?',
      })
      .expect(200);

    const reply3 = res3.body.reply || '';
    console.log(`  AI Reply: "${reply3}"`);
    const didNotAskToRespecify =
      !/which product are you asking about/i.test(reply3) &&
      !/please specify/i.test(reply3) &&
      reply3.length > 20;
    assertCondition(
      'Turn 3 Follow-up Context Continuity',
      didNotAskToRespecify,
      `Answered sequentially without confusion`,
    );

    // =========================================================================
    // SCENARIO 2: Memory Isolation Across Sessions
    // =========================================================================
    console.log('\n---------------------------------------------------------------');
    console.log('▶ [SCENARIO 2] Memory Isolation Across Sessions (POST /api/v1/chat)');
    console.log('---------------------------------------------------------------');

    console.log('\n[Turn 1] New Conversation ID (test-memory-999)');
    console.log('  User: "What is my name?"');
    const resIso = await request(server)
      .post('/api/v1/chat')
      .send({
        tenantId,
        conversationId: conv999,
        message: 'What is my name?',
      })
      .expect(200);

    const replyIso = resIso.body.reply || '';
    console.log(`  AI Reply: "${replyIso}"`);
    const doesNotKnowAlex =
      !replyIso.toLowerCase().includes('your name is alex') &&
      !replyIso.toLowerCase().includes('you are alex');
    assertCondition(
      'Session Isolation: Does NOT leak name from session 101 into 999',
      doesNotKnowAlex,
      `Memory isolated for conversation ${conv999}`,
    );

    // =========================================================================
    // SCENARIO 3: Memory Retention in SSE Streaming (POST /api/v1/chat/stream)
    // =========================================================================
    console.log('\n---------------------------------------------------------------');
    console.log('▶ [SCENARIO 3] Memory Retention in SSE Streaming (POST /api/v1/chat/stream)');
    console.log('---------------------------------------------------------------');

    const streamMessageHelper = async (msg: string): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        let accumulatedText = '';
        request(server)
          .post('/api/v1/chat/stream')
          .send({
            tenantId,
            conversationId: conv202,
            message: msg,
          })
          .buffer(false)
          .parse((res, callback) => {
            res.on('data', (chunk) => {
              const str = chunk.toString();
              const lines = str.split('\n').filter((l: string) => l.startsWith('data:'));
              for (const line of lines) {
                try {
                  const data = JSON.parse(line.replace('data:', '').trim());
                  if (data.type === 'chunk' && data.content) {
                    accumulatedText += data.content;
                  }
                } catch {}
              }
            });
            res.on('end', () => {
              callback(null, accumulatedText);
              resolve(accumulatedText);
            });
            res.on('error', (err) => reject(err));
          })
          .end((err) => {
            if (err) reject(err);
          });
      });
    };

    console.log('\n[Stream Turn 1] Setting context in stream');
    console.log('  User: "I want to buy a birthday gift for my 5-year-old son"');
    const streamReply1 = await streamMessageHelper(
      'I want to buy a birthday gift for my 5-year-old son',
    );
    console.log(`  Streamed AI Reply 1: "${streamReply1.slice(0, 120)}..."`);
    assertCondition(
      'Stream Turn 1 Completed',
      streamReply1.length > 0,
      `Streamed ${streamReply1.length} characters`,
    );

    console.log('\n[Stream Turn 2] Implicit memory query in stream');
    console.log('  User: "What age was the gift for?"');
    const streamReply2 = await streamMessageHelper('What age was the gift for?');
    console.log(`  Streamed AI Reply 2: "${streamReply2}"`);
    const streamRecallsAge = /5/i.test(streamReply2) || /five/i.test(streamReply2);
    assertCondition(
      'Stream Turn 2 Recalls Age ("5" or "5-year-old")',
      streamRecallsAge,
      `Stream memory recalled: ${streamRecallsAge}`,
    );

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n===============================================================');
    console.log(`  TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('===============================================================\n');

    if (passedTests !== totalTests) {
      throw new Error(`Only ${passedTests}/${totalTests} tests passed.`);
    }
  } catch (error) {
    console.error('❌ Memory Test Suite failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await prisma.message.deleteMany({
        where: { conversationId: { in: [conv101, conv999, conv202] } },
      });
      await prisma.conversation.deleteMany({
        where: { id: { in: [conv101, conv999, conv202] } },
      });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
      await redisService.del(`chat:history:${tenantId}:${conv101}`);
      await redisService.del(`chat:history:${tenantId}:${conv999}`);
      await redisService.del(`chat:history:${tenantId}:${conv202}`);
    } catch {}

    await app.close();
    process.exit(0);
  }
}

runMemoryTests().catch((err) => {
  console.error('Fatal error in memory test runner:', err);
  process.exit(1);
});
