import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { ChatService } from './chat.service';
import { randomUUID } from 'crypto';

async function bootstrap() {
  console.log('\n======================================================');
  console.log('  COMMERCE AI CHAT ORCHESTRATOR & RAG TEST RUNNER');
  console.log('======================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const embeddingsService = app.get(EmbeddingsService);
  const chatService = app.get(ChatService);

  const testTenantId = `tenant-${randomUUID().slice(0, 8)}`;
  console.log(`[1] Created Test Tenant Context: ${testTenantId}`);

  // Test catalog to seed
  const sampleProducts = [
    {
      id: randomUUID(),
      tenantId: testTenantId,
      name: 'CloudVelocity Blue Running Sneakers',
      description: 'Super-responsive lightweight marathon road running shoes with breathable mesh and responsive foam.',
      price: 145.0,
      category: 'Footwear',
      attributes: { color: 'Blue', sizes: ['8', '9', '10', '11'], activity: 'Running' },
    },
    {
      id: randomUUID(),
      tenantId: testTenantId,
      name: 'SummitGrip Trail Running Shoes',
      description: 'Durable grip trail shoes for off-road runners with rock protection plate.',
      price: 160.0,
      category: 'Footwear',
      attributes: { color: 'Dark Olive', sizes: ['9', '10', '12'], activity: 'Trail Running' },
    },
    {
      id: randomUUID(),
      tenantId: testTenantId,
      name: 'HydroShield Running Windbreaker',
      description: 'Ultralight water-resistant reflective running jacket for rainy morning runs.',
      price: 89.99,
      category: 'Apparel',
      attributes: { color: 'Neon Blue', size: ['M', 'L', 'XL'] },
    },
  ];

  try {
    console.log('\n[2] Seeding product catalog with vector embeddings...');
    for (const product of sampleProducts) {
      const textToEmbed = `${product.name}. ${product.description} Category: ${product.category}. Color: ${product.attributes.color}`;
      const embedding = await embeddingsService.generateEmbedding(textToEmbed);
      const vectorString = `[${embedding.join(',')}]`;

      await prisma.$executeRaw`
        INSERT INTO products (
          id,
          tenant_id,
          name,
          description,
          price,
          category,
          attributes,
          embedding,
          created_at,
          updated_at
        ) VALUES (
          ${product.id},
          ${product.tenantId},
          ${product.name},
          ${product.description},
          ${product.price},
          ${product.category},
          ${JSON.stringify(product.attributes)}::jsonb,
          ${vectorString}::vector,
          NOW(),
          NOW()
        );
      `;
      console.log(`  ✓ Seeded: "${product.name}" ($${product.price})`);
    }

    // Test Scenarios
    const testCases = [
      {
        description: 'Scenario A: Customer Greeting',
        message: 'Hello! Good morning, how are you?',
        expectedIntent: 'GREETING',
      },
      {
        description: 'Scenario B: Product Query (RAG Search)',
        message: 'Do you have any blue running shoes?',
        expectedIntent: 'QUERY_PRODUCT',
      },
      {
        description: 'Scenario C: Order Status Tracking',
        message: 'Where is my order #ORD-88492?',
        expectedIntent: 'CHECK_ORDER',
      },
      {
        description: 'Scenario D: Add to Cart',
        message: 'Please add the CloudVelocity shoes to my cart in size 10',
        expectedIntent: 'ADD_TO_CART',
      },
    ];

    console.log('\n[3] Running Conversational Orchestration Scenarios:\n');

    for (const testCase of testCases) {
      console.log(`------------------------------------------------------`);
      console.log(`▶ ${testCase.description}`);
      console.log(`User: "${testCase.message}"`);

      const response = await chatService.processMessage(testTenantId, testCase.message);

      console.log(`AI Response (Intent: ${response.intent} [${(response.confidence * 100).toFixed(1)}%]):`);
      console.log(response.reply);

      if (response.suggestedProducts && response.suggestedProducts.length > 0) {
        console.log(`RAG Grounded Products (${response.suggestedProducts.length} items):`);
        response.suggestedProducts.forEach((p) => {
          console.log(`   - ${p.name} ($${p.price}) | Similarity: ${(p.similarity * 100).toFixed(1)}%`);
        });
      }

      console.log('');
    }

    console.log('ALL SCENARIOS EXECUTED SUCCESSFULLY.\n');
  } catch (error) {
    console.error('Chat Orchestrator Test failed:', error);
  } finally {
    console.log('[4] Cleaning up test tenant products from database...');
    try {
      const deleted = await prisma.$executeRaw`
        DELETE FROM products WHERE tenant_id = ${testTenantId};
      `;
      console.log(`  ✓ Cleaned up ${deleted} test records.`);
    } catch (cleanupError) {
      console.warn(`Cleanup notice: ${cleanupError.message}`);
    }

    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  }
}

bootstrap().catch((err) => {
  console.error('Fatal error in chat test runner:', err);
  process.exit(1);
});
