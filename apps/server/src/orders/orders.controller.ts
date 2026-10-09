import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import {
  IStoreProvider,
  OrderSummaryResult,
  STORE_PROVIDER,
} from '../products/interfaces/store-provider.interface';

@Controller('api')
export class OrdersController {
  constructor(
    @Inject(STORE_PROVIDER)
    private readonly storeProvider: IStoreProvider,
  ) {}

  /** GET /api/orders/:orderNumber?tenantId=... */
  @Get('orders/:orderNumber')
  async getOrder(
    @Param('orderNumber') orderNumber: string,
    @Query('tenantId') tenantId = 'demo-store-01',
  ): Promise<{ order: OrderSummaryResult }> {
    const order = await this.storeProvider.getOrderSummary(tenantId, orderNumber);
    if (!order) {
      throw new NotFoundException(`Order #${orderNumber} not found for tenant ${tenantId}`);
    }
    return { order };
  }
}
