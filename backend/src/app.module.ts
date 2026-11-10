import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CommissionGateService } from './billing/commission-gate.service';
import { NoopPaymentProvider, PAYMENT_PROVIDER } from './billing/payment-provider';
import { ReceivablesService } from './billing/receivables.service';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { ENV, loadEnv } from './config/env';
import { DbService } from './db/db.service';
import { DeliveryService } from './delivery/delivery.service';
import { RateLimitService } from './delivery/rate-limit.service';
import { LoadsController } from './loads/loads.controller';
import { LoadsService } from './loads/loads.service';

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
    ReceivablesService,
    CommissionGateService,
    { provide: PAYMENT_PROVIDER, useClass: NoopPaymentProvider },
    JwtAuthGuard,
  ],
})
export class AppModule {}
