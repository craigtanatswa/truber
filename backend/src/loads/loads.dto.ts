import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LOAD_STATUSES, TRUCK_TYPES } from '../domain';
import { PageQueryDto } from '../companies/companies.dto';

export class GeoPointDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class MoneyDto {
  @IsInt()
  amountMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class CreateLoadDto {
  @IsUUID()
  companyId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  goodsType!: string;

  @IsInt()
  @Min(1)
  weightKg!: number;

  @IsIn(TRUCK_TYPES)
  truckTypeRequired!: (typeof TRUCK_TYPES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  pickupAddress!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  pickupPoint?: GeoPointDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  destinationAddress!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  destinationPoint?: GeoPointDto;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  loadingDate!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deliveryDeadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialRequirements?: string;

  @IsIn(['fixed', 'negotiable'])
  rateType!: 'fixed' | 'negotiable';

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDto)
  offeredRate?: MoneyDto;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class UpdateLoadDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  goodsType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  weightKg?: number;

  @IsOptional()
  @IsIn(TRUCK_TYPES)
  truckTypeRequired?: (typeof TRUCK_TYPES)[number];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  pickupAddress?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => GeoPointDto)
  pickupPoint?: GeoPointDto | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  destinationAddress?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => GeoPointDto)
  destinationPoint?: GeoPointDto | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  loadingDate?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deliveryDeadline?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  specialRequirements?: string | null;

  @IsOptional()
  @IsIn(['fixed', 'negotiable'])
  rateType?: 'fixed' | 'negotiable';

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => MoneyDto)
  offeredRate?: MoneyDto | null;
}

export class ListLoadsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(LOAD_STATUSES)
  status?: (typeof LOAD_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  pickupDateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  pickupDateTo?: string;

  @IsOptional()
  @IsIn(TRUCK_TYPES)
  truckTypeRequired?: (typeof TRUCK_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxWeightKg?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  pickupText?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  destinationText?: string;
}

export class CancelLoadDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
