import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../companies/companies.dto';
import { TRUCK_TYPES, TruckType, VerificationStatus } from '../domain';

const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;

export class ListTrucksQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsIn(TRUCK_TYPES)
  truckType?: TruckType;

  @IsOptional()
  @IsIn(VERIFICATION_STATUSES)
  verificationStatus?: VerificationStatus;

  // availableOn is accepted and ignored: the contract has no truck availability data yet. Planned for removal in API v0.5.1.
  @IsOptional()
  @IsString()
  availableOn?: string;
}

export class CreateTruckDto {
  @IsUUID()
  companyId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  registrationNumber!: string;

  @IsIn(TRUCK_TYPES)
  truckType!: TruckType;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  capacityKg!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  trailerSpecs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  insuranceReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentLocationText?: string;
}

export class UpdateTruckDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(TRUCK_TYPES)
  truckType?: TruckType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  capacityKg?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  trailerSpecs?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  insuranceReference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentLocationText?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(VERIFICATION_STATUSES)
  verificationStatus?: VerificationStatus;
}
