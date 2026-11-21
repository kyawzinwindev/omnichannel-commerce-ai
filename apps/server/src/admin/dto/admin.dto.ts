import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

/** Accepts ["Red","Blue"] or "Red, Blue"; trims, drops blanks and case-insensitive duplicates. */
const toOptionList = ({ value }: { value: unknown }) => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(raw)) return raw;
  const seen = new Set<string>();
  return raw
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => {
      if (typeof v !== 'string' || !v) return false;
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

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
  @IsOptional() @Transform(toOptionList) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) colors?: string[];
  @IsOptional() @Transform(toOptionList) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(20, { each: true }) sizes?: string[];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) description?: string;
}

export class UpdateProductDto {
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) brand?: string;
  @IsOptional() @IsIn(GENDER_VALUES) targetGender?: (typeof GENDER_VALUES)[number];
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) categoryType?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) price?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) stock?: number;
  @IsOptional() @Transform(toOptionList) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(40, { each: true }) colors?: string[];
  @IsOptional() @Transform(toOptionList) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(20, { each: true }) sizes?: string[];
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
