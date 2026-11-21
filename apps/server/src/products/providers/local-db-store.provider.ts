import { Injectable, Logger } from '@nestjs/common';
import { Gender, Prisma, Product } from '@prisma/client';
import {
  IStoreProvider,
  OrderSummaryResult,
  ProductItem,
  ProductSearchFilters,
} from '../interfaces/store-provider.interface';
import { PrismaService } from '../../database/prisma.service';
import {
  ScoredProduct,
  VectorSearchService,
  normalizeBrandFilter,
  normalizeCategoryFilter,
  normalizeGenderFilter,
} from '../../chat/vector-search.service';
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

  private mapScoredProduct(p: ScoredProduct): ProductItem {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.price),
      brand: p.brand,
      targetGender: p.target_gender,
      category: p.category_type,
      stock: p.stock,
      inStock: p.stock > 0,
      colors: p.colors ?? [],
      sizes: p.sizes ?? [],
      attributes: p.attributes,
      similarity: p.similarity,
      rrfScore: p.rrf_score,
    };
  }

  private mapDbProduct(p: Product): ProductItem {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.price),
      brand: p.brand,
      targetGender: p.targetGender,
      category: p.categoryType,
      stock: p.stock,
      inStock: p.stock > 0,
      colors: p.colors,
      sizes: p.sizes,
      image: p.image,
      attributes: p.attributes as Record<string, any>,
    };
  }

  /**
   * Builds a Redis v3 cache key differentiating query text and structured metadata filters.
   */
  buildProductCacheKey(
    tenantId: string,
    query?: string,
    limit = 5,
    filters?: ProductSearchFilters,
  ): string {
    const q = query && query.trim() ? query.toLowerCase().trim() : 'all';
    const b = filters?.brand && filters.brand.trim() ? filters.brand.toLowerCase().trim() : 'all';
    const g =
      filters?.targetGender && filters.targetGender.trim()
        ? filters.targetGender.toLowerCase().trim()
        : 'all';
    const c =
      filters?.categoryType && filters.categoryType.trim()
        ? filters.categoryType.toLowerCase().trim()
        : 'all';
    return `cache:products:v3:${tenantId}:${q}:${b}:${g}:${c}:${limit}`;
  }

  /**
   * Retrieves products using RRF Hybrid Search (pgvector + full-text keyword search)
   * with structured metadata pre-filtering and a zero-result relaxed fallback.
   */
  async getProductList(
    tenantId: string,
    query?: string,
    limit = 5,
    filters?: ProductSearchFilters,
  ): Promise<ProductItem[]> {
    const cacheKey = this.buildProductCacheKey(tenantId, query, limit, filters);

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.debug(`[Redis Cache Hit] Products for key: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (cacheErr) {
      this.logger.warn(`Redis get error: ${cacheErr.message}`);
    }

    const hasActiveFilters = Boolean(
      (filters?.brand && filters.brand.trim()) ||
        (filters?.targetGender && filters.targetGender.trim()) ||
        (filters?.categoryType && filters.categoryType.trim()),
    );
    const hasQuery = Boolean(query && query.trim());

    let products: ProductItem[] = [];

    if (hasQuery || hasActiveFilters) {
      const effectiveQuery =
        query && query.trim()
          ? query.trim()
          : [filters?.brand, filters?.targetGender, filters?.categoryType].filter(Boolean).join(' ');

      try {
        let scoredProducts = await this.vectorSearchService.searchSimilarProducts(
          tenantId,
          effectiveQuery,
          limit,
          0.25,
          hasActiveFilters ? filters : undefined,
        );

        // Zero-Result Graceful Fallback: retry once without strict metadata filters
        if (scoredProducts.length === 0 && hasActiveFilters && hasQuery) {
          this.logger.debug(
            `Hybrid search with filters ${JSON.stringify(filters)} returned 0 results for "${effectiveQuery}"; retrying with relaxed query-only hybrid search.`,
          );
          scoredProducts = await this.vectorSearchService.searchSimilarProducts(
            tenantId,
            effectiveQuery,
            limit,
            0.25,
            undefined,
          );
        }

        products = scoredProducts.map((p) => this.mapScoredProduct(p));
      } catch (vectorError) {
        this.logger.warn(`Hybrid search failed, attempting fallback: ${vectorError.message}`);
        if (hasActiveFilters && hasQuery) {
          try {
            const relaxed = await this.vectorSearchService.searchSimilarProducts(
              tenantId,
              effectiveQuery,
              limit,
              0.25,
              undefined,
            );
            products = relaxed.map((p) => this.mapScoredProduct(p));
          } catch {
            products = await this.fallbackSqlSearch(tenantId, effectiveQuery, limit, filters);
          }
        } else {
          products = await this.fallbackSqlSearch(tenantId, effectiveQuery, limit, filters);
        }
      }
    } else {
      const dbProducts = await this.prisma.product.findMany({
        where: { tenantId },
        take: limit,
      });
      products = dbProducts.map((p) => this.mapDbProduct(p));
    }

    // Cache results in Redis
    try {
      await this.redisService.set(cacheKey, JSON.stringify(products), this.CACHE_TTL_SECONDS);
    } catch (cacheErr) {
      this.logger.warn(`Redis set error: ${cacheErr.message}`);
    }

    return products;
  }

  private async fallbackSqlSearch(
    tenantId: string,
    query: string,
    limit: number,
    filters?: ProductSearchFilters,
  ): Promise<ProductItem[]> {
    const brand = normalizeBrandFilter(filters?.brand);
    const gender = normalizeGenderFilter(filters?.targetGender);
    const category = normalizeCategoryFilter(filters?.categoryType);

    const buildWhere = (withFilters: boolean): Prisma.ProductWhereInput => {
      const where: Prisma.ProductWhereInput = { tenantId };
      if (withFilters) {
        if (brand) where.brand = { equals: brand, mode: 'insensitive' };
        if (category) where.categoryType = { equals: category, mode: 'insensitive' };
        if (gender && gender in Gender) {
          where.targetGender = { in: [gender as Gender, Gender.UNISEX] };
        }
      }
      if (query) {
        where.OR = [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { categoryType: { contains: query, mode: 'insensitive' } },
          { brand: { contains: query, mode: 'insensitive' } },
        ];
      }
      return where;
    };

    const hasFilters = Boolean(brand || gender || category);
    let rows = await this.prisma.product.findMany({
      where: buildWhere(hasFilters),
      take: limit,
    });
    if (rows.length === 0 && hasFilters && query) {
      rows = await this.prisma.product.findMany({
        where: buildWhere(false),
        take: limit,
      });
    }
    return rows.map((p) => this.mapDbProduct(p));
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
        color: i.color,
        size: i.size,
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
