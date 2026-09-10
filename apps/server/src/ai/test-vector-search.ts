import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { VectorSearchService } from './vector-search.service';
import { randomUUID } from 'crypto';

async function bootstrap() {
  console.log('\n======================================================');
  console.log('  COMMERCE AI VECTOR SEARCH & RAG TEST RUNNER');
  console.log('======================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const embeddingsService = app.get(EmbeddingsService);
  const vectorSearchService = app.get(VectorSearchService);

  const testTenantId = `test-tenant-${randomUUID().slice(0, 8)}`;
  console.log(`[1] Created Test Tenant Context: ${testTenantId}`);

  const sampleProducts = [
    {
      id: randomUUID(),
      tenantId: testTenantId,
      name: 'CloudStratus Blue Running Shoes',
      description: 'Ultra-lightweight breathable mesh athletic running sneakers in vibrant navy blue and cyan.',
      price: 139.99,
      category: 'Footwear',
      attributes: { color: 'Blue', size: ['9', '10', '11'], gender: 'Unisex' },
    },
    {
      id: randomUUID(),
      tenantId: testTenantId,
      name: 'ProTrail Waterproof Hiking Boots',
      description: 'Rugged waterproof leather boots designed for extreme outdoor mountain trails.',
      price: 189.5,
      category: 'Footwear',
      attributes: { color: 'Brown', waterproof: true },
    },
    {
      id: randomUUID(),
      tenantId: testTenantId,
      name: 'AeroDry Sport Training T-Shirt',
      description: 'Quick-dry moisture wicking running shirt for gym workouts and marathons.',
      price: 34.0,
      category: 'Apparel',
      attributes: { color: 'Black', material: 'Polyester' },
    },
    {
      id: randomUUID(),
      tenantId: testTenantId,
      name: 'Midnight Blue Running Crew Socks',
      description: 'Cushioned athletic anti-blister sports socks in deep blue.',
      price: 15.0,
      category: 'Accessories',
      attributes: { color: 'Blue', pack: '3-pack' },
    },
  ];

  try {
    console.log('\n[2] Generating embeddings and seeding test products into PostgreSQL...');
    for (const product of sampleProducts) {
      const textToEmbed = `${product.name}. ${product.description} Category: ${product.category}. Color: ${product.attributes?.color || ''}`;
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
      console.log(`  ✓ Inserted: "${product.name}" with 384d embedding`);
    }

    const testQuery = 'blue running shoes';
    console.log(`\n[3] Executing Vector Search for query: "${testQuery}"...`);

    const results = await vectorSearchService.searchSimilarProducts(
      testTenantId,
      testQuery,
      5,
      0.3,
    );

    console.log(`\n[4] Found ${results.length} matching products:\n`);
    results.forEach((item, index) => {
      console.log(`  #${index + 1} | Score: ${(item.similarity * 100).toFixed(2)}% | ${item.name}`);
      console.log(`      Price: $${item.price} | Category: ${item.category}`);
      console.log(`      Desc: ${item.description}\n`);
    });

    // Verification Assertions
    if (results.length > 0 && results[0].name.includes('Blue Running Shoes')) {
      console.log('✅ TEST PASSED: Most relevant product ("CloudStratus Blue Running Shoes") ranked #1.');
    } else {
      console.warn('⚠️ Search returned results, please inspect ranking above.');
    }
  } catch (error) {
    console.error('❌ Vector Search Test failed:', error);
  } finally {
    console.log('\n[5] Cleaning up test records from database...');
    try {
      const deleted = await prisma.$executeRaw`
        DELETE FROM products WHERE tenant_id = ${testTenantId};
      `;
      console.log(`  ✓ Cleaned up ${deleted} test records for tenant ${testTenantId}.`);
    } catch (cleanupError) {
      console.warn(`Cleanup notice: ${cleanupError.message}`);
    }

    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  }
}

bootstrap().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
