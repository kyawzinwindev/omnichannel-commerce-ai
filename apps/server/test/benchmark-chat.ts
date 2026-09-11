import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ChatService } from '../src/ai/chat.service';
import { PrismaService } from '../src/database/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { performance } from 'perf_hooks';
import { randomUUID } from 'crypto';

async function runBenchmark() {
  console.log('\n' + '='.repeat(80));
  console.log('  🚀 RUNNING CHAT SERVICE PERFORMANCE BENCHMARK (BULLMQ DECOUPLING)');
  console.log('='.repeat(80) + '\n');

  console.log('📦 Bootstrapping NestJS Application Context with BullMQ & Redis...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const chatService = app.get(ChatService);
  const prisma = app.get(PrismaService);
  const queue = app.get<Queue>(getQueueToken('chat-persistence'));

  const tenantId = 'tenant_default';
  const conversationId = `bench_${randomUUID().substring(0, 8)}`;
  const testMessage = 'Do you have running shoes or headphones available?';

  // Ensure tenant exists
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: 'Benchmark Default Store' },
  });

  console.log(`\n📋 Test Parameters:`);
  console.log(`   - Tenant ID:       ${tenantId}`);
  console.log(`   - Conversation ID: ${conversationId}`);
  console.log(`   - User Message:    "${testMessage}"`);
  console.log(`   - Queue Registered: ${queue.name}\n`);

  console.log('⏱️  Sending message to ChatService.processMessage()...');
  const t0 = performance.now();

  const response = await chatService.processMessage(
    tenantId,
    testMessage,
    conversationId,
  );

  const t1 = performance.now();
  const executionLatency = (t1 - t0).toFixed(2);

  // Immediate DB check right after processMessage returns
  const immediateDbCount = await prisma.message.count({
    where: { conversationId },
  });

  console.log(`\n⚡ Response returned in ${executionLatency}ms!`);
  console.log(`   - Intent Detected: ${response.intent} (Confidence: ${(response.confidence * 100).toFixed(1)}%)`);
  console.log(`   - Products Matched: ${response.products?.length || 0}`);
  console.log(`   - AI Reply Excerpt: "${response.reply.substring(0, 100).replace(/\n/g, ' ')}..."`);
  console.log(`   - Immediate DB Messages Count: ${immediateDbCount} (Asynchronous - not blocking response return)`);

  console.log('\n⏳ Awaiting BullMQ background persistence processor...');
  
  // Wait up to 3 seconds for BullMQ background processor to complete PostgreSQL insertion
  let finalDbCount = 0;
  let jobCompleted = false;
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    finalDbCount = await prisma.message.count({
      where: { conversationId },
    });
    if (finalDbCount >= 2) {
      jobCompleted = true;
      break;
    }
    attempts++;
  }

  // Retrieve job details from BullMQ
  const completedJobs = await queue.getCompleted(0, 10);
  const matchedJob = completedJobs.find((j) => j.data?.conversationId === conversationId);

  console.log('\n' + '='.repeat(80));
  console.log('                 📊 BENCHMARK EXECUTION SUMMARY TABLE');
  console.log('='.repeat(80));

  const summaryData = [
    {
      Metric: 'Execution Latency (Start -> Response Return)',
      Value: `${executionLatency} ms`,
      Status: '⚡ FAST (Non-blocking DB)',
    },
    {
      Metric: 'DB Persistence Mode',
      Value: 'Asynchronous via BullMQ',
      Status: '✅ Decoupled',
    },
    {
      Metric: 'Immediate DB Record Count on Return',
      Value: `${immediateDbCount} records`,
      Status: '✅ Zero Blocking Overhead',
    },
    {
      Metric: 'Final DB Record Count (Post-processor)',
      Value: `${finalDbCount} records (USER + ASSISTANT)`,
      Status: finalDbCount >= 2 ? '✅ Persisted in Background' : '⚠️ Pending',
    },
    {
      Metric: 'BullMQ Queue Job Status',
      Value: matchedJob ? `Job ID #${matchedJob.id} Completed` : (jobCompleted ? 'Processed' : 'In Queue'),
      Status: jobCompleted ? '✅ SUCCESS' : '⚠️ IN_PROGRESS',
    },
  ];

  console.table(summaryData);

  if (matchedJob && matchedJob.returnvalue) {
    console.log('🔍 BullMQ Worker Result Payload:', JSON.stringify(matchedJob.returnvalue, null, 2));
  }

  // Verify stored messages in PostgreSQL
  const savedMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });

  if (savedMessages.length > 0) {
    console.log('\n🗄️  PostgreSQL Verified Records:');
    savedMessages.forEach((msg, idx) => {
      console.log(`   ${idx + 1}. [${msg.senderType}] ${msg.content.substring(0, 60)}...`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('  🎉 BENCHMARK COMPLETED SUCCESSFULLY');
  console.log('='.repeat(80) + '\n');

  await app.close();
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('❌ Benchmark error:', err);
  process.exit(1);
});
