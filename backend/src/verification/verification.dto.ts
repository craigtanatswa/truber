import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQueryDto } from '../companies/companies.dto';
import { VerificationDocumentType } from '../domain';

export const VERIFICATION_DOCUMENT_TYPES = [
  'national_id',
  'company_registration',
  'tax_clearance',
  'vehicle_registration',
  'insurance',
  'other',
] as const;

export class ListVerificationDocumentsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

// The contract has no mimeType or size fields, so none are accepted
// (forbidNonWhitelisted returns 400 for them).
export class CreateVerificationDocumentDto {
  @IsIn(VERIFICATION_DOCUMENT_TYPES)
  documentType!: VerificationDocumentType;

  @IsString()
  @MaxLength(2048)
  documentUri!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  truckId?: string;
}

export class ReviewVerificationDocumentDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNotes?: string;

  @IsOptional()
  @IsBoolean()
  setCompanyVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  setTruckVerified?: boolean;
}
