import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string;

  @IsIn(['shipper', 'transporter'])
  role!: 'shipper' | 'transporter';
}

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MaxLength(256)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken!: string;
}

export class PasswordResetRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  @Matches(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)
  email!: string;
}

export class PasswordResetConfirmDto {
  @IsString()
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  newPassword!: string;
}

export class OtpRequestDto {
  @IsOptional()
  @IsIn(['sms', 'email'])
  channel?: 'sms' | 'email';
}

export class VerifyOtpDto {
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  code!: string;
}
