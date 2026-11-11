import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../companies/companies.dto';

export class QuotationAmountDto {
  @IsInt()
  @Min(1)
  // Storage bound (PostgreSQL integer, same as loads.offered_amount_minor). The contract sets no maximum.
  @Max(2147483647)
  amountMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class CreateQuotationDto {
  @IsUUID()
  transporterCompanyId!: string;

  @IsOptional()
  @IsUUID()
  truckId?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => QuotationAmountDto)
  amount!: QuotationAmountDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsISO8601()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)
  validUntil!: string;
}

export class AcceptQuotationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ListQuotationsQueryDto extends PageQueryDto {}
