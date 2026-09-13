import { Injectable, Logger } from '@nestjs/common';
import {
  IStoreProvider,
  OrderSummaryResult,
  ProductItem,
} from '../interfaces/store-provider.interface';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class ExternalClientApiProvider implements IStoreProvider {
  private readonly logger = new Logger(ExternalClientApiProvider.name);
  private readonly CACHE_TTL_SECONDS = 180; // 3 minutes

  constructor(private readonly redisService: RedisService) {}

  /**
   * Fetches product list from external Merchant / Shopify REST/GraphQL API.
   */
  async getProductList(tenantId: string, query?: string, limit = 5): Promise<ProductItem[]> {
    this.logger.log(
      `[ExternalClientApiProvider] Fetching products from external client API for tenant [${tenantId}] with query: "${query}"`,
    );

    const cacheKey = `cache:ext:products:${tenantId}:${query ? query.toLowerCase().trim() : 'all'}`;

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn(`Redis cache lookup error: ${err.message}`);
    }

    // Mock external store response (or actual fetch call to process.env.EXTERNAL_STORE_API_URL)
    const mockExternalProducts: ProductItem[] = [
      {
        id: 'ext-item-1',
        name: 'Canvas Weekender Bag (Store Edition)',
        description: 'Waxed cotton tan bag from external merchant catalog.',
        price: 128.0,
        category: 'Bags',
        inStock: true,
        attributes: { source: 'Shopify / Merchant API' },
      },
      {
        id: 'ext-item-2',
        name: 'Modern Minimalist Desk Lamp',
        description: 'Matte black aluminum LED lamp from partner inventory.',
        price: 85.0,
        category: 'Home',
        inStock: true,
        attributes: { source: 'Shopify / Merchant API' },
      },
    ];

    const results = query
      ? mockExternalProducts.filter((p) =>
          p.name.toLowerCase().includes(query.toLowerCase()),
        )
      : mockExternalProducts;

    try {
      await this.redisService.set(cacheKey, JSON.stringify(results), this.CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Redis cache save error: ${err.message}`);
    }

    return results.slice(0, limit);
  }

  /**
   * Fetches order summary from external merchant OMS API.
   */
  async getOrderSummary(tenantId: string, orderNumber: string): Promise<OrderSummaryResult | null> {
    const cleanOrderNumber = orderNumber.replace(/^#/, '').trim();
    this.logger.log(
      `[ExternalClientApiProvider] Fetching order summary for #${cleanOrderNumber} from client OMS`,
    );

    return {
      orderNumber: cleanOrderNumber,
      status: 'accepted',
      customerName: 'Alex Johnson',
      shippingAddress: '123 Market St, Suite 400, San Francisco, CA 94105',
      items: [
        {
          id: 'ext-item-1',
          name: 'Canvas Weekender Bag (Store Edition)',
          quantity: 1,
          price: 128.0,
        },
      ],
      totalAmount: 128.0,
      orderDate: 'Sep 6, 2026',
    };
  }
}
