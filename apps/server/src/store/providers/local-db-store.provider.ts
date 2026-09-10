import { Injectable, Logger } from '@nestjs/common';
import {
  IStoreProvider,
  OrderTimelineResult,
  ProductItem,
} from '../interfaces/store-provider.interface';
import { PrismaService } from '../../database/prisma.service';
import { VectorSearchService } from '../../ai/vector-search.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class LocalDbStoreProvider implements IStoreProvider {
  private readonly logger = new Logger(LocalDbStoreProvider.name);
  private readonly CACHE_TTL_SECONDS = 300; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Retrieves products using vector similarity search (if query given) or direct catalog lookup,
   * accelerated with Redis caching.
   */
  async getProductList(tenantId: string, query?: string, limit = 5): Promise<ProductItem[]> {
    const cacheKey = `cache:products:${tenantId}:${query ? query.toLowerCase().trim() : 'all'}:${limit}`;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.debug(`[Redis Cache Hit] Products for key: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (cacheErr) {
      this.logger.warn(`Redis get error: ${cacheErr.message}`);
    }

    let products: ProductItem[] = [];

    if (query && query.trim()) {
      try {
        const scoredProducts = await this.vectorSearchService.searchSimilarProducts(
          tenantId,
          query,
          limit,
          0.3,
        );

        products = scoredProducts.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          category: p.category,
          inStock: true,
          attributes: p.attributes,
          similarity: p.similarity,
        }));
      } catch (vectorError) {
        this.logger.warn(`Vector search failed, falling back to SQL LIKE: ${vectorError.message}`);
        const dbProducts = await this.prisma.product.findMany({
          where: {
            tenantId,
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
              { category: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: limit,
        });

        products = dbProducts.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          category: p.category,
          inStock: p.inStock,
          image: p.image,
          attributes: p.attributes as Record<string, any>,
        }));
      }
    } else {
      const dbProducts = await this.prisma.product.findMany({
        where: { tenantId },
        take: limit,
      });

      products = dbProducts.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: Number(p.price),
        category: p.category,
        inStock: p.inStock,
        image: p.image,
        attributes: p.attributes as Record<string, any>,
      }));
    }

    // Cache results in Redis
    try {
      await this.redisService.set(cacheKey, JSON.stringify(products), this.CACHE_TTL_SECONDS);
    } catch (cacheErr) {
      this.logger.warn(`Redis set error: ${cacheErr.message}`);
    }

    return products;
  }

  /**
   * Retrieves order status timeline from PostgreSQL with Redis caching.
   */
  async getOrderTimeline(tenantId: string, orderNumber: string): Promise<OrderTimelineResult | null> {
    const cleanOrderNumber = orderNumber.replace(/^#/, '').trim();
    const cacheKey = `cache:order:${tenantId}:${cleanOrderNumber}`;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.debug(`[Redis Cache Hit] Order for key: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (cacheErr) {
      this.logger.warn(`Redis get error: ${cacheErr.message}`);
    }

    const order = await this.prisma.order.findUnique({
      where: {
        tenantId_orderNumber: {
          tenantId,
          orderNumber: cleanOrderNumber,
        },
      },
      include: {
        steps: {
          orderBy: { stepIndex: 'asc' },
        },
      },
    });

    if (!order) {
      return null;
    }

    const result: OrderTimelineResult = {
      orderNumber: order.orderNumber,
      status: order.status,
      customerEmail: order.customerEmail,
      totalAmount: Number(order.totalAmount),
      steps: order.steps.map((step) => ({
        title: step.title,
        timestamp: step.timestampStr,
        status: step.status as 'completed' | 'current' | 'pending',
        icon: (step.icon as 'check' | 'truck' | 'home' | 'package') || 'package',
      })),
    };

    // Cache order in Redis
    try {
      await this.redisService.set(cacheKey, JSON.stringify(result), this.CACHE_TTL_SECONDS);
    } catch (cacheErr) {
      this.logger.warn(`Redis set error: ${cacheErr.message}`);
    }

    return result;
  }
}
