import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  IStoreProvider,
  OrderSummaryResult,
  ProductItem,
  STORE_PROVIDER,
} from './interfaces/store-provider.interface';

@Controller('api')
export class StoreController {
  constructor(
    @Inject(STORE_PROVIDER)
    private readonly storeProvider: IStoreProvider,
  ) {}

  /**
   * GET /api/products?tenantId=...&query=...&limit=...
   */
  @Get('products')
  async getProducts(
    @Query('tenantId') tenantId = 'demo-store-01',
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ): Promise<{ products: ProductItem[] }> {
    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const products = await this.storeProvider.getProductList(
      tenantId,
      query,
      parsedLimit,
    );
    return { products };
  }

  /**
   * GET /api/orders/:orderNumber?tenantId=...
   */
  @Get('orders/:orderNumber')
  async getOrder(
    @Param('orderNumber') orderNumber: string,
    @Query('tenantId') tenantId = 'demo-store-01',
  ): Promise<{ order: OrderSummaryResult }> {
    const order = await this.storeProvider.getOrderSummary(
      tenantId,
      orderNumber,
    );
    if (!order) {
      throw new NotFoundException(`Order #${orderNumber} not found for tenant ${tenantId}`);
    }
    return { order };
  }
}
