import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const GENDER_VALUES = ['MEN', 'WOMEN', 'UNISEX'] as const;
export const ORDER_STATUS_VALUES = ['pending', 'accepted', 'rejected', 'processing', 'delivered'] as const;
export type OrderStatusValue = (typeof ORDER_STATUS_VALUES)[number];

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;
}

export class ListProductsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() categoryType?: string;
  @IsOptional() @IsString() search?: string;
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() search?: string;
  /** Inclusive range start (ISO date). */
  @IsOptional() @IsISO8601() from?: string;
  /** Inclusive range end (ISO date). */
  @IsOptional() @IsISO8601() to?: string;
}

export class CreateProductDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) brand: string;
  @IsIn(GENDER_VALUES) targetGender: (typeof GENDER_VALUES)[number];
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) categoryType: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price: number;
  @Type(() => Number) @IsInt() @Min(0) stock: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
}

export class UpdateProductDto {
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) brand?: string;
  @IsOptional() @IsIn(GENDER_VALUES) targetGender?: (typeof GENDER_VALUES)[number];
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) categoryType?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) stock?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
}

export class UpdateOrderStatusDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(ORDER_STATUS_VALUES)
  status: OrderStatusValue;
}

export class ReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  text: string;
}

export class ToggleModeDto {
  /** Optional explicit target; when omitted the current mode is flipped. */
  @IsOptional()
  @IsBoolean()
  isHumanMode?: boolean;
}
