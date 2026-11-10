import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { ENV, loadEnv } from './config/env';
import { DbService } from './db/db.service';
import { DeliveryService } from './delivery/delivery.service';
import { RateLimitService } from './delivery/rate-limit.service';
import { LoadsController } from './loads/loads.controller';
import { LoadsService } from './loads/loads.service';
import { OffPlatformBanService } from './offplatform/offplatform-ban.service';

@Module({
  controllers: [AuthController, CompaniesController, LoadsController],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    DbService,
    RateLimitService,
    DeliveryService,
    AuthService,
    CompaniesService,
    LoadsService,
    OffPlatformBanService,
    JwtAuthGuard,
  ],
})
export class AppModule {}
