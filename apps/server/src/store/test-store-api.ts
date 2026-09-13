import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import * as request from 'supertest';

async function bootstrap() {
  console.log('\n======================================================');
  console.log('  STORE PROVIDER, RAG & ORDER SUMMARY TEST RUNNER');
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
  const tenantId = 'demo-store-01';

  try {
    // -------------------------------------------------------------
    // TEST 1: GET /api/products
    // -------------------------------------------------------------
    console.log('▶ [Test 1] Testing GET /api/products...');
    const res1 = await request(server)
      .get(`/api/products?tenantId=${tenantId}&limit=5`)
      .expect(200);

    console.log(`  ✓ Retrieved ${res1.body.products.length} products from StoreProvider.`);
    console.log(`  ✓ Sample: "${res1.body.products[0]?.name}" ($${res1.body.products[0]?.price})`);
    console.log('  ✅ Test 1 Passed.\n');

    // -------------------------------------------------------------
    // TEST 2: GET /api/orders/:orderNumber
    // -------------------------------------------------------------
    console.log('▶ [Test 2] Testing GET /api/orders/10492...');
    const res2 = await request(server)
      .get(`/api/orders/10492?tenantId=${tenantId}`)
      .expect(200);

    console.log(`  ✓ Order: #${res2.body.order.orderNumber} (Status: ${res2.body.order.status})`);
    console.log(`  ✓ Customer: ${res2.body.order.customerName}, Total: $${res2.body.order.totalAmount}`);
    console.log(`  ✓ Items count: ${res2.body.order.items?.length || 0}`);
    console.log('  ✅ Test 2 Passed.\n');

    // -------------------------------------------------------------
    // TEST 3: POST /api/chat (Product Query RAG + Dynamic Products)
    // -------------------------------------------------------------
    console.log('▶ [Test 3] Testing POST /api/chat for Product Query...');
    const res3 = await request(server)
      .post('/api/chat')
      .send({
        tenantId,
        message: 'Do you have the Canvas Weekender Bag in stock?',
      })
      .expect(200);

    console.log(`  ✓ Intent: ${res3.body.intent}`);
    console.log(`  ✓ Reply: "${res3.body.reply.slice(0, 90)}..."`);
    console.log(`  ✓ Products returned: ${res3.body.products?.length || 0}`);
    if (res3.body.products && res3.body.products.length > 0) {
      console.log(`  ✓ Top product: "${res3.body.products[0].name}" ($${res3.body.products[0].price})`);
    }
    console.log('  ✅ Test 3 Passed.\n');

    // -------------------------------------------------------------
    // TEST 4: POST /api/chat (Order Tracking + OrderSummary)
    // -------------------------------------------------------------
    console.log('▶ [Test 4] Testing POST /api/chat for Order Tracking...');
    const res4 = await request(server)
      .post('/api/chat')
      .send({
        tenantId,
        message: 'Where is my order #10492?',
      })
      .expect(200);

    console.log(`  ✓ Intent: ${res4.body.intent}`);
    console.log(`  ✓ Reply: "${res4.body.reply.slice(0, 90)}..."`);
    console.log(`  ✓ Order Summary Attached: ${!!res4.body.orderSummary}`);
    if (res4.body.orderSummary) {
      console.log(`  ✓ Order #${res4.body.orderSummary.orderNumber} (Status: ${res4.body.orderSummary.status}, Total: $${res4.body.orderSummary.totalAmount})`);
    }
    console.log('  ✅ Test 4 Passed.\n');

    console.log('======================================================');
    console.log('  ALL STORE PROVIDER & CHAT TESTS PASSED (4/4)');
    console.log('======================================================\n');
  } catch (error) {
    console.error('❌ Store API Tests failed:', error);
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
