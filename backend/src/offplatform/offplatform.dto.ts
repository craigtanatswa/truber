import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../companies/companies.dto';
import {
  OffPlatformBanStatus,
  OffPlatformOutcome,
  OffPlatformPartyRole,
  OffPlatformReportStatus,
  OffPlatformSuspectedParty,
} from './offplatform.types';

export class CreateOffPlatformReportDto {
  @IsIn(['shipper', 'transporter', 'both', 'unknown'])
  suspectedParty!: OffPlatformSuspectedParty;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ require_protocol: true }, { each: true })
  evidenceUris?: string[];
}

export class ResponsiblePartyDto {
  @IsIn(['shipper', 'transporter'])
  role!: OffPlatformPartyRole;

  @IsUUID()
  userId!: string;

  @IsUUID()
  companyId!: string;
}

export class RecordOffPlatformFindingDto {
  @IsIn(['confirmed', 'not_confirmed'])
  outcome!: OffPlatformOutcome;

  @IsString()
  @MinLength(8)
  @MaxLength(4000)
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ResponsiblePartyDto)
  responsibleParties?: ResponsiblePartyDto[];
}

export class LiftOffPlatformBanDto {
  @IsString()
  @MinLength(8)
  @MaxLength(4000)
  liftReason!: string;
}

export class ListOffPlatformReportsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['open', 'confirmed', 'not_confirmed'])
  status?: OffPlatformReportStatus;

  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class ListOffPlatformBansQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['active', 'expired', 'lifted'])
  status?: OffPlatformBanStatus;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}
