import { Injectable, Logger } from '@nestjs/common';
import {
  IStoreProvider,
  OrderSummaryResult,
  ProductItem,
} from '../interfaces/store-provider.interface';
import { PrismaService } from '../../database/prisma.service';
import { VectorSearchService } from '../../chat/vector-search.service';
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
          brand: p.brand,
          targetGender: p.target_gender,
          category: p.category_type,
          stock: p.stock,
          inStock: p.stock > 0,
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
              { categoryType: { contains: query, mode: 'insensitive' } },
              { brand: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: limit,
        });

        products = dbProducts.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          brand: p.brand,
          targetGender: p.targetGender,
          category: p.categoryType,
          stock: p.stock,
          inStock: p.stock > 0,
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
        brand: p.brand,
        targetGender: p.targetGender,
        category: p.categoryType,
        stock: p.stock,
        inStock: p.stock > 0,
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
   * Retrieves order summary from PostgreSQL with Redis caching.
   */
  async getOrderSummary(tenantId: string, orderNumber: string): Promise<OrderSummaryResult | null> {
    const cleanOrderNumber = orderNumber.replace(/^#/, '').trim();
    const cacheKey = `cache:order_summary:${tenantId}:${cleanOrderNumber}`;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.debug(`[Redis Cache Hit] Order summary for key: ${cacheKey}`);
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
      include: { items: true },
    });

    if (!order) {
      return null;
    }

    const mapStatus = (statusStr: string): 'accepted' | 'rejected' | 'pending' | 'processing' => {
      const s = statusStr.toLowerCase();
      if (s === 'accepted' || s === 'completed' || s === 'delivered' || s === 'in_transit') return 'accepted';
      if (s === 'rejected' || s === 'cancelled') return 'rejected';
      if (s === 'pending') return 'pending';
      return 'processing';
    };

    const result: OrderSummaryResult = {
      orderNumber: order.orderNumber,
      status: mapStatus(order.status),
      customerName: order.customerName || 'Valued Customer',
      shippingAddress: order.shippingAddress || undefined,
      items: order.items.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        price: Number(i.price),
      })),
      totalAmount: Number(order.totalAmount),
      orderDate: order.createdAt
        ? new Date(order.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : undefined,
    };

    // Cache order summary in Redis
    try {
      await this.redisService.set(cacheKey, JSON.stringify(result), this.CACHE_TTL_SECONDS);
    } catch (cacheErr) {
      this.logger.warn(`Redis set error: ${cacheErr.message}`);
    }

    return result;
  }
}
