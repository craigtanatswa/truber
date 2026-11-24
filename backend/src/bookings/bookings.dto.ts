import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../companies/companies.dto';
import { BookingStatus, TripStatus } from '../domain';

export class ListBookingsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['pending_payment_arrangement', 'confirmed', 'cancelled'])
  status?: BookingStatus;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class UpdateTripStatusDto {
  @IsIn(['not_started', 'truck_dispatched', 'goods_collected', 'in_transit', 'delivered'])
  tripStatus!: TripStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ConfirmBookingDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  auditOverrideReason?: string;
}

export class CancelBookingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  beforeCollection?: boolean;
}

export class ConfirmDeliveryDto {
  @IsIn(['accepted', 'disputed'])
  decision!: 'accepted' | 'disputed';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class NonNegativeMoneyDto {
  @IsInt()
  @Min(0)
  // Storage bound (PostgreSQL integer, same as the money columns).
  @Max(2147483647)
  amountMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class DisputeEvidenceDto {
  @IsIn(['photo', 'signed_pod', 'message', 'other'])
  kind!: 'photo' | 'signed_pod' | 'message' | 'other';

  @IsUrl({ require_protocol: true })
  uri!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RaiseDisputeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DisputeEvidenceDto)
  evidence?: DisputeEvidenceDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NonNegativeMoneyDto)
  proposedAmount?: NonNegativeMoneyDto;
}

export class RespondToDisputeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  statement!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DisputeEvidenceDto)
  evidence?: DisputeEvidenceDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NonNegativeMoneyDto)
  counterOfferAmount?: NonNegativeMoneyDto;
}

export class AcceptDisputeSettlementDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => NonNegativeMoneyDto)
  amount!: NonNegativeMoneyDto;
}

export class ResolveDisputeDto {
  @IsIn(['complete_trip', 'adjust_amount', 'cancel_trip'])
  resolution!: 'complete_trip' | 'adjust_amount' | 'cancel_trip';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NonNegativeMoneyDto)
  adjustedAgreedAmount?: NonNegativeMoneyDto;
}

export class RecordBookingAdjustmentDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => NonNegativeMoneyDto)
  adjustedAgreedAmount!: NonNegativeMoneyDto;

  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  reason!: string;

  @IsOptional()
  @IsUUID()
  disputeId?: string;
}
