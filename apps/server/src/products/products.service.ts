import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Prisma, Product } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface ProductInput {
  name: string;
  brand: string;
  targetGender: Gender;
  categoryType: string;
  price: number;
  stock: number;
  description?: string;
}

const toDto = (p: Product) => ({
  id: p.id,
  name: p.name,
  brand: p.brand,
  targetGender: p.targetGender,
  categoryType: p.categoryType,
  price: Number(p.price),
  description: p.description,
  stock: p.stock,
  inStock: p.stock > 0,
});

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

  private async findOrFail(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async create(tenantId: string, input: ProductInput) {
    const product = await this.prisma.product.create({ data: { tenantId, ...input } });
    return toDto(product);
  }

  async get(tenantId: string, id: string) {
    return toDto(await this.findOrFail(tenantId, id));
  }

  async update(tenantId: string, id: string, input: Partial<ProductInput>) {
    await this.findOrFail(tenantId, id);
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return toDto(await this.prisma.product.update({ where: { id }, data }));
  }

  /** Hard delete, refused while the product is referenced by existing order items. */
  async remove(tenantId: string, id: string) {
    await this.findOrFail(tenantId, id);
    const refs = await this.prisma.orderItem.count({ where: { productId: id } });
    if (refs > 0) {
      throw new ConflictException(
        `Product is referenced by ${refs} order item(s) and cannot be deleted. Set its stock to 0 instead.`,
      );
    }
    await this.prisma.product.delete({ where: { id } });
  }

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
      data: rows.map(toDto),
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
