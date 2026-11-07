import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListCompaniesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['shipper', 'transporter'])
  type?: 'shipper' | 'transporter';

  @IsOptional()
  @IsIn(['unverified', 'pending', 'verified', 'rejected'])
  verificationStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
}

export class CreateCompanyDto {
  @IsIn(['shipper', 'transporter'])
  type!: 'shipper' | 'transporter';

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  legalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradingName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNumber?: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tradingName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNumber?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @IsIn(['unverified', 'pending', 'verified', 'rejected'])
  verificationStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
}
