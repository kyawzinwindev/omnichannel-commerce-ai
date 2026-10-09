import { Injectable } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface ListProductsParams {
  tenantId: string;
  page: number;
  pageSize: number;
  brand?: string;
  gender?: string;
  categoryType?: string;
  search?: string;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Paginated catalog listing with brand / gender / type filters (admin dashboard). */
  async list(params: ListProductsParams) {
    const { tenantId, page, pageSize, brand, gender, categoryType, search } = params;

    const where: Prisma.ProductWhereInput = { tenantId };
    if (brand) where.brand = { equals: brand, mode: 'insensitive' };
    if (categoryType) where.categoryType = { equals: categoryType, mode: 'insensitive' };
    if (gender && gender.toUpperCase() in Gender) where.targetGender = gender.toUpperCase() as Gender;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [total, rows, brands, categoryTypes] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ brand: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.findMany({
        where: { tenantId },
        distinct: ['brand'],
        select: { brand: true },
        orderBy: { brand: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { tenantId },
        distinct: ['categoryType'],
        select: { categoryType: true },
        orderBy: { categoryType: 'asc' },
      }),
    ]);

    return {
      data: rows.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        targetGender: p.targetGender,
        categoryType: p.categoryType,
        price: Number(p.price),
        description: p.description,
        stock: p.stock,
        inStock: p.stock > 0,
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      filters: {
        brands: brands.map((b) => b.brand).filter(Boolean),
        categoryTypes: categoryTypes.map((c) => c.categoryType).filter(Boolean),
        genders: Object.values(Gender),
      },
    };
  }
}
