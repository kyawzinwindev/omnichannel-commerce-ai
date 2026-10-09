import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
