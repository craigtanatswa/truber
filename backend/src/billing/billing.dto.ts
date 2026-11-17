import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class RecordCommissionCollectionAmountDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class RecordCommissionCollectionDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => RecordCommissionCollectionAmountDto)
  amount!: RecordCommissionCollectionAmountDto;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
