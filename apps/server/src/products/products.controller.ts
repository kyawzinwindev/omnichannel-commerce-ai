import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  IStoreProvider,
  ProductItem,
  STORE_PROVIDER,
} from './interfaces/store-provider.interface';

@Controller('api')
export class ProductsController {
  constructor(
    @Inject(STORE_PROVIDER)
    private readonly storeProvider: IStoreProvider,
  ) {}

  /** GET /api/products?tenantId=...&query=...&limit=... */
  @Get('products')
  async getProducts(
    @Query('tenantId') tenantId = 'demo-store-01',
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ): Promise<{ products: ProductItem[] }> {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const products = await this.storeProvider.getProductList(tenantId, query, parsedLimit);
    return { products };
  }
}
