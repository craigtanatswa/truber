import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from './commission';

const PAYMENT_METHODS: PaymentMethod[] = [
  'prepay',
  'escrow',
  'deposit_balance',
  'cash',
  'corporate_credit',
];

export class PayoutPreviewAmountDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class PayoutPreviewDto {
  @IsUUID()
  transporterCompanyId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PayoutPreviewAmountDto)
  amount!: PayoutPreviewAmountDto;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsUUID()
  loadId?: string;
}
