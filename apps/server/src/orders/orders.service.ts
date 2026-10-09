import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CartItem, DraftOrder } from '../redis/session-state';

export interface CreateOrderInput {
  tenantId: string;
  orderNumber: string;
  status: 'accepted' | 'rejected' | 'pending' | 'processing';
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
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  /** Paginated order listing with customer info and an items summary (admin dashboard). */
  async list(params: ListOrdersParams) {
    const { tenantId, page, pageSize, status, search } = params;
    const where: Prisma.OrderWhereInput = { tenantId };
    if (status) where.status = status.toLowerCase();
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ];
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
      data: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        totalAmount: Number(o.totalAmount),
        createdAt: o.createdAt,
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
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }
}
