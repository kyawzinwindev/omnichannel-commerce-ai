import { Gender, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const TENANT_ID = 'demo-store-01';
const ADMIN_EMAIL = 'admin@gmail.com';
const ADMIN_PASSWORD = 'P@55w0rd';

type CategoryType = 'Pants' | 'Shorts' | 'T-Shirts' | 'Hoodies' | 'Jackets' | 'Dresses';
type Brand = 'Nike' | 'Adidas' | 'Puma' | 'Uniqlo';

const BRANDS: Brand[] = ['Nike', 'Adidas', 'Puma', 'Uniqlo'];

const GENDER_LABEL: Record<Gender, string> = {
  MEN: "Men's",
  WOMEN: "Women's",
  UNISEX: 'Unisex',
};

/** Six distinct styles per category; every brand/gender combination sells the first five. */
const STYLES: Record<CategoryType, string[]> = {
  Pants: ['Joggers', 'Track Pants', 'Tapered Trousers', 'Cargo Pants', 'Fleece Sweatpants', 'Training Pants'],
  Shorts: ['Running Shorts', 'Training Shorts', 'Fleece Shorts', 'Basketball Shorts', 'Woven Shorts', 'Lounge Shorts'],
  'T-Shirts': ['Classic Tee', 'Performance Tee', 'Graphic Tee', 'Oversized Tee', 'Pocket Tee', 'Ringer Tee'],
  Hoodies: ['Pullover Hoodie', 'Full-Zip Hoodie', 'Fleece Hoodie', 'Oversized Hoodie', 'Training Hoodie', 'Heavyweight Hoodie'],
  Jackets: ['Windbreaker', 'Puffer Jacket', 'Track Jacket', 'Bomber Jacket', 'Rain Jacket', 'Fleece Jacket'],
  Dresses: ['Tennis Dress', 'Midi Dress', 'Sports Dress', 'Wrap Dress', 'T-Shirt Dress', 'Maxi Dress'],
};

const BASE_PRICE: Record<CategoryType, number> = {
  Pants: 55,
  Shorts: 32,
  'T-Shirts': 25,
  Hoodies: 65,
  Jackets: 95,
  Dresses: 62,
};

const BRAND_PRICE_FACTOR: Record<Brand, number> = { Nike: 1.15, Adidas: 1.05, Puma: 0.9, Uniqlo: 0.75 };

const BRAND_TECH: Record<Brand, string> = {
  Nike: 'Dri-FIT moisture-wicking fabric',
  Adidas: 'AEROREADY moisture-absorbing technology',
  Puma: 'dryCELL sweat-wicking technology',
  Uniqlo: 'soft everyday-comfort cotton blend',
};

const MATERIALS: Record<CategoryType, string[]> = {
  Pants: ['French terry cotton', 'Recycled polyester', 'Stretch twill'],
  Shorts: ['Lightweight woven polyester', 'Cotton jersey', 'Ripstop nylon'],
  'T-Shirts': ['Combed cotton', 'Recycled polyester', 'Cotton-modal blend'],
  Hoodies: ['Brushed fleece', 'Cotton French terry', 'Heavyweight cotton'],
  Jackets: ['Water-repellent nylon', 'Recycled polyester shell', 'Quilted insulation'],
  Dresses: ['Stretch jersey', 'Breathable knit', 'Soft cotton blend'],
};

const COLORS = ['Black', 'White', 'Navy', 'Heather Grey', 'Olive', 'Burgundy', 'Sky Blue', 'Sand', 'Forest Green'];

const SIZES: Record<Gender, string[]> = {
  MEN: ['S', 'M', 'L', 'XL', 'XXL'],
  WOMEN: ['XS', 'S', 'M', 'L', 'XL'],
  UNISEX: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
};

/** Which gender/category combinations each brand sells. */
function combosFor(brand: Brand): Array<{ gender: Gender; type: CategoryType }> {
  const combos: Array<{ gender: Gender; type: CategoryType }> = [];
  for (const type of ['Pants', 'Shorts', 'T-Shirts', 'Hoodies', 'Jackets'] as CategoryType[]) {
    combos.push({ gender: 'MEN', type });
  }
  for (const type of ['Pants', 'Shorts', 'T-Shirts', 'Hoodies', 'Jackets', 'Dresses'] as CategoryType[]) {
    combos.push({ gender: 'WOMEN', type });
  }
  if (brand === 'Uniqlo' || brand === 'Puma') {
    for (const type of ['T-Shirts', 'Hoodies', 'Jackets'] as CategoryType[]) {
      combos.push({ gender: 'UNISEX', type });
    }
  }
  return combos;
}

/** Deterministic pseudo-random generator so re-seeding yields the same catalog. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeedProduct {
  id: string;
  name: string;
  brand: Brand;
  gender: Gender;
  categoryType: CategoryType;
  price: number;
  description: string;
  stock: number;
  attributes: Record<string, unknown>;
}

function buildCatalog(): SeedProduct[] {
  const rand = mulberry32(20261009);
  const products: SeedProduct[] = [];
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  BRANDS.forEach((brand) => {
    for (const { gender, type } of combosFor(brand)) {
      const styles = STYLES[type];
      for (let i = 0; i < 5; i++) {
        const style = styles[i];
        const name = `${brand} ${GENDER_LABEL[gender]} ${style}`;
        const color = COLORS[Math.floor(rand() * COLORS.length)];
        const material = MATERIALS[type][Math.floor(rand() * MATERIALS[type].length)];
        const price = Math.round(BASE_PRICE[type] * BRAND_PRICE_FACTOR[brand] * (0.85 + rand() * 0.5)) - 0.01;
        const roll = rand();
        const stock = roll < 0.07 ? 0 : roll < 0.2 ? Math.floor(1 + rand() * 6) : Math.floor(15 + rand() * 120);

        products.push({
          id: `${slug(brand)}-${gender.toLowerCase()}-${slug(type)}-${i + 1}`,
          name,
          brand,
          gender,
          categoryType: type,
          price,
          stock,
          description:
            `${brand} ${GENDER_LABEL[gender].toLowerCase()} ${style.toLowerCase()} in ${color.toLowerCase()}, ` +
            `made from ${material.toLowerCase()} with ${BRAND_TECH[brand]}. ` +
            `Designed for ${type === 'Dresses' ? 'effortless style' : 'training and everyday wear'}.`,
          attributes: { color, material, sizes: SIZES[gender], style },
        });
      }
    }
  });

  return products;
}

async function seedAdmin() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, role: Role.ADMIN },
    create: { email: ADMIN_EMAIL, passwordHash, role: Role.ADMIN },
  });
  console.log(`✓ Admin user [${ADMIN_EMAIL}] ready.`);
}

async function seedProducts() {
  console.log('Loading Xenova embeddings pipeline for vector generation...');
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

  const generateVector = async (text: string) => {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return `[${Array.from(output.data as Float32Array).join(',')}]`;
  };

  const catalog = buildCatalog();

  // Replace the whole tenant catalog so re-running the seed is idempotent.
  await prisma.$executeRaw`DELETE FROM products WHERE tenant_id = ${TENANT_ID};`;

  console.log(`Seeding ${catalog.length} apparel products with vector embeddings...`);
  for (const p of catalog) {
    const text =
      `${p.name}. ${p.description} Brand: ${p.brand}. Gender: ${GENDER_LABEL[p.gender]}. ` +
      `Category: ${p.categoryType}. Color: ${p.attributes.color}.`;
    const vector = await generateVector(text);

    await prisma.$executeRaw`
      INSERT INTO products (
        id, tenant_id, name, description, price, brand, target_gender,
        category_type, stock, image, attributes, embedding, created_at, updated_at
      ) VALUES (
        ${p.id}, ${TENANT_ID}, ${p.name}, ${p.description}, ${p.price}, ${p.brand},
        ${p.gender}::"Gender", ${p.categoryType}, ${p.stock}, ${''},
        ${JSON.stringify(p.attributes)}::jsonb, ${vector}::vector, NOW(), NOW()
      );
    `;
  }
  console.log(`✓ ${catalog.length} products seeded (${BRANDS.length} brands).`);
  return catalog;
}

async function seedOrders(catalog: SeedProduct[]) {
  const pick = (name: string) => catalog.find((p) => p.name === name) ?? catalog[0];

  const samples = [
    {
      orderNumber: '10492',
      status: 'accepted',
      customerName: 'Alex Johnson',
      phone: '+1 555 0142',
      address: '742 Evergreen Terrace, Springfield, OR 97477',
      items: [
        { product: pick("Adidas Men's Joggers"), quantity: 1 },
        { product: pick("Uniqlo Unisex Oversized Tee"), quantity: 2 },
      ],
    },
    {
      orderNumber: 'ORD-20418',
      status: 'accepted',
      customerName: 'Mia Chen',
      phone: '+1 555 0177',
      address: '18 Harbor View Rd, Seattle, WA 98101',
      items: [{ product: pick("Nike Women's Running Shorts"), quantity: 1 }],
    },
    {
      orderNumber: 'ORD-20431',
      status: 'rejected',
      customerName: 'Daniel Okafor',
      phone: '+1 555 0109',
      address: '550 Market St, Austin, TX 78701',
      items: [{ product: pick("Puma Men's Windbreaker"), quantity: 1 }],
    },
    {
      orderNumber: 'ORD-20456',
      status: 'accepted',
      customerName: 'Sofia Martins',
      phone: '+1 555 0163',
      address: '9 Lakeshore Dr, Chicago, IL 60601',
      items: [
        { product: pick("Adidas Women's Track Pants"), quantity: 1 },
        { product: pick("Nike Women's Pullover Hoodie"), quantity: 1 },
      ],
    },
    {
      orderNumber: 'ORD-20477',
      status: 'pending',
      customerName: 'Liam Walker',
      phone: '+1 555 0121',
      address: '204 Pine St, Denver, CO 80202',
      items: [{ product: pick("Uniqlo Men's Classic Tee"), quantity: 3 }],
    },
  ];

  for (const s of samples) {
    const totalAmount = s.items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
    const order = await prisma.order.upsert({
      where: { tenantId_orderNumber: { tenantId: TENANT_ID, orderNumber: s.orderNumber } },
      update: {},
      create: {
        tenantId: TENANT_ID,
        orderNumber: s.orderNumber,
        status: s.status,
        totalAmount,
        customerName: s.customerName,
        customerPhone: s.phone,
        shippingAddress: s.address,
        customerEmail: `${s.customerName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      },
    });

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderItem.createMany({
      data: s.items.map((i) => ({
        orderId: order.id,
        productId: i.product.id,
        name: i.product.name,
        quantity: i.quantity,
        price: i.product.price,
      })),
    });

    await prisma.order.update({ where: { id: order.id }, data: { totalAmount, status: s.status } });

    await prisma.orderStatusStep.deleteMany({ where: { orderId: order.id } });
    await prisma.orderStatusStep.createMany({
      data: [
        { id: randomUUID(), orderId: order.id, title: 'Order placed', timestampStr: 'Sep 6, 9:14 AM', status: 'completed', icon: 'check', stepIndex: 1 },
        { id: randomUUID(), orderId: order.id, title: 'In Transit', timestampStr: 'Sep 8, 11:20 AM', status: 'current', icon: 'truck', stepIndex: 2 },
        { id: randomUUID(), orderId: order.id, title: 'Delivered', timestampStr: 'Estimated Sep 11', status: 'pending', icon: 'home', stepIndex: 3 },
      ],
    });
  }
  console.log(`✓ ${samples.length} sample orders seeded.`);
}

async function main() {
  console.log('🌱 Starting database seeding for Omnichannel Commerce AI...');

  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: 'Apparel Commerce Store' },
    create: { id: TENANT_ID, name: 'Apparel Commerce Store', apiKey: 'key-demo-artisan-001' },
  });
  console.log(`✓ Tenant [${TENANT_ID}] ready.`);

  await seedAdmin();
  const catalog = await seedProducts();
  await seedOrders(catalog);

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
