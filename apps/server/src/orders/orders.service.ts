import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CartItem, DraftOrder } from '../redis/session-state';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

const toDto = (o: OrderWithItems) => ({
  id: o.id,
  orderNumber: o.orderNumber,
  status: o.status,
  totalAmount: Number(o.totalAmount),
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
  customer: {
    name: o.customerName,
    phone: o.customerPhone,
    email: o.customerEmail,
    shippingAddress: o.shippingAddress,
  },
  itemsSummary: o.items.map((i) => `${i.quantity}× ${i.name}`).join(', '),
  items: o.items.map((i) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    price: Number(i.price),
  })),
});

export interface CreateOrderInput {
  tenantId: string;
  orderNumber: string;
  status: 'accepted' | 'rejected' | 'pending' | 'processing' | 'delivered';
  customer: DraftOrder;
  cart: CartItem[];
  totalAmount: number;
}

export interface ListOrdersParams {
  tenantId: string;
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Persists a confirmed order (with line items) coming from the chat flow. */
  async create(input: CreateOrderInput) {
    const { tenantId, orderNumber, status, customer, cart, totalAmount } = input;
    try {
      return await this.prisma.order.create({
        data: {
          tenantId,
          orderNumber,
          status,
          totalAmount,
          customerName: customer.name,
          customerPhone: customer.phone,
          shippingAddress: customer.address,
          customerEmail: customer.phone
            ? `${customer.phone.replace(/[^0-9]/g, '')}@customer.local`
            : 'customer@store.local',
          items: {
            create: cart.map((c) => ({
              productId: c.productId,
              name: c.name,
              quantity: c.quantity,
              price: c.price,
            })),
          },
        },
      });
    } catch (err) {
      this.logger.warn(`Could not save order ${orderNumber}: ${(err as Error).message}`);
      return null;
    }
  }

  async get(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: { items: true } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return toDto(order);
  }

  async updateStatus(tenantId: string, id: string, status: string) {
    const existing = await this.get(tenantId, id);
    const order = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: { items: true },
    });
    await this.invalidateSummary(tenantId, existing.orderNumber);
    return toDto(order);
  }

  /** Removes an invalid/cancelled order (line items cascade). */
  async remove(tenantId: string, id: string) {
    const existing = await this.get(tenantId, id);
    await this.prisma.order.delete({ where: { id } });
    await this.invalidateSummary(tenantId, existing.orderNumber);
  }

  private async invalidateSummary(tenantId: string, orderNumber: string) {
    try {
      await this.redis.del(`cache:order_summary:${tenantId}:${orderNumber}`);
    } catch (err) {
      this.logger.warn(`Could not invalidate order cache: ${(err as Error).message}`);
    }
  }

  /** Paginated order listing with customer info and an items summary (admin dashboard). */
  async list(params: ListOrdersParams) {
    const { tenantId, page, pageSize, status, search, from, to } = params;
    const where: Prisma.OrderWhereInput = { tenantId };
    if (status) where.status = status.toLowerCase();
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const end = new Date(to);
        // A bare date (YYYY-MM-DD) should include the whole day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map(toDto),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }
}
