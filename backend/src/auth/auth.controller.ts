import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest, sourceKey } from '../common/http';
import { AuthService } from './auth.service';
import {
  LoginDto,
  OtpRequestDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RefreshDto,
  RegisterDto,
  VerifyOtpDto,
} from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(201)
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthedRequest) {
    return this.auth.me(req.user);
  }

  @Post('password-reset/request')
  @HttpCode(202)
  requestPasswordReset(@Body() body: PasswordResetRequestDto, @Req() req: AuthedRequest) {
    return this.auth.requestPasswordReset(body, sourceKey(req));
  }

  @Post('password-reset/confirm')
  @HttpCode(200)
  confirmPasswordReset(@Body() body: PasswordResetConfirmDto, @Req() req: AuthedRequest) {
    return this.auth.confirmPasswordReset(body, sourceKey(req));
  }

  @Post('otp/request')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  requestOtp(@Body() body: OtpRequestDto, @Req() req: AuthedRequest) {
    return this.auth.requestOtp(req.user, body.channel ?? 'sms', sourceKey(req));
  }

  @Post('otp/verify')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  verifyOtp(@Body() body: VerifyOtpDto, @Req() req: AuthedRequest) {
    return this.auth.verifyOtp(req.user, body);
  }
}
