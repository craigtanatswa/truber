import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AccountStatus } from '../domain';

const ACCOUNT_STATUSES = ['pending_verification', 'active', 'suspended', 'disabled'] as const;

export class UpdateUserDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(ACCOUNT_STATUSES)
  accountStatus?: AccountStatus;
}
