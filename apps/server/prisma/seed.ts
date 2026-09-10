import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding for Omnichannel Commerce AI...');

  // 1. Initialize Transformers embedding pipeline
  console.log('Loading Xenova embeddings pipeline for vector generation...');
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true,
  });

  async function generateVector(text: string): Promise<string> {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return `[${Array.from(output.data).join(',')}]`;
  }

  // 2. Seed Default Tenant
  const tenantId = 'demo-store-01';
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: 'Artisan Commerce Store' },
    create: {
      id: tenantId,
      name: 'Artisan Commerce Store',
      apiKey: 'key-demo-artisan-001',
    },
  });
  console.log(`✓ Tenant [${tenantId}] ready.`);

  // 3. Seed Products
  const products = [
    {
      id: 'prod-101',
      tenantId,
      name: 'Canvas Weekender Bag',
      description: 'Waxed cotton tan travel duffle with leather straps and brass hardware.',
      price: 128.0,
      category: 'Bags',
      inStock: true,
      image: '',
      attributes: { material: 'Waxed Cotton', color: 'Tan', capacity: '40L' },
    },
    {
      id: 'prod-102',
      tenantId,
      name: 'Full-Grain Leather Bifold Wallet',
      description: 'Handcrafted premium full-grain brown leather wallet with RFID protection.',
      price: 48.0,
      category: 'Accessories',
      inStock: true,
      image: '',
      attributes: { material: 'Leather', color: 'Brown', rfid: true },
    },
    {
      id: 'prod-103',
      tenantId,
      name: 'Modern Minimalist Desk Lamp',
      description: 'Sleek matte black aluminum task light with touch-dimming and warm LED temperature.',
      price: 85.0,
      category: 'Home & Decor',
      inStock: true,
      image: '',
      attributes: { color: 'Matte Black', wattage: '10W', dimmable: true },
    },
    {
      id: 'prod-104',
      tenantId,
      name: 'CloudStratus Athletic Running Shoes',
      description: 'Ultra-lightweight breathable mesh marathon road running sneakers in deep navy blue.',
      price: 139.99,
      category: 'Footwear',
      inStock: true,
      image: '',
      attributes: { color: 'Navy Blue', sizes: ['8', '9', '10', '11'], activity: 'Running' },
    },
    {
      id: 'prod-105',
      tenantId,
      name: 'Stainless Steel Insulated Tumbler',
      description: '24oz double-wall vacuum insulated stainless steel water bottle keeps cold for 24hrs.',
      price: 29.5,
      category: 'Drinkware',
      inStock: true,
      image: '',
      attributes: { capacity: '24oz', color: 'Midnight Blue', dishwasherSafe: true },
    },
  ];

  console.log('Seeding products with vector embeddings...');
  for (const item of products) {
    const textToEmbed = `${item.name}. ${item.description} Category: ${item.category}. ${JSON.stringify(item.attributes)}`;
    const vectorString = await generateVector(textToEmbed);

    // Delete existing item if present to avoid conflicts
    await prisma.$executeRaw`DELETE FROM products WHERE id = ${item.id};`;

    await prisma.$executeRaw`
      INSERT INTO products (
        id,
        tenant_id,
        name,
        description,
        price,
        category,
        in_stock,
        image,
        attributes,
        embedding,
        created_at,
        updated_at
      ) VALUES (
        ${item.id},
        ${item.tenantId},
        ${item.name},
        ${item.description},
        ${item.price},
        ${item.category},
        ${item.inStock},
        ${item.image},
        ${JSON.stringify(item.attributes)}::jsonb,
        ${vectorString}::vector,
        NOW(),
        NOW()
      );
    `;
    console.log(`  ✓ Product: "${item.name}" ($${item.price})`);
  }

  // 4. Seed Sample Orders
  const orderNumber = '10492';
  const order = await prisma.order.upsert({
    where: {
      tenantId_orderNumber: {
        tenantId,
        orderNumber,
      },
    },
    update: {
      customerEmail: 'alex@example.com',
      totalAmount: 128.0,
      status: 'in_transit',
    },
    create: {
      id: 'order-10492',
      tenantId,
      orderNumber,
      customerEmail: 'alex@example.com',
      totalAmount: 128.0,
      status: 'in_transit',
    },
  });

  // Clean and recreate steps
  await prisma.orderStatusStep.deleteMany({ where: { orderId: order.id } });

  await prisma.orderStatusStep.createMany({
    data: [
      {
        id: randomUUID(),
        orderId: order.id,
        title: 'Order placed',
        timestampStr: 'Sep 6, 9:14 AM',
        status: 'completed',
        icon: 'check',
        stepIndex: 1,
      },
      {
        id: randomUUID(),
        orderId: order.id,
        title: 'In Transit',
        timestampStr: 'Sep 8, 11:20 AM',
        status: 'current',
        icon: 'truck',
        stepIndex: 2,
      },
      {
        id: randomUUID(),
        orderId: order.id,
        title: 'Delivered',
        timestampStr: 'Estimated Sep 11',
        status: 'pending',
        icon: 'home',
        stepIndex: 3,
      },
    ],
  });

  console.log(`✓ Sample Order #${orderNumber} seeded with 3 status timeline steps.`);
  console.log('✅ Database seeding complete!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
