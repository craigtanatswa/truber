import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { BillingController } from './billing/billing.controller';
import { CommissionGateService } from './billing/commission-gate.service';
import { NoopPaymentProvider, PAYMENT_PROVIDER } from './billing/payment-provider';
import { ReceivablesService } from './billing/receivables.service';
import { AdminOnlyGuard } from './common/admin-only.guard';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { ENV, Env, loadEnv } from './config/env';
import { DbService } from './db/db.service';
import { DeliveryService } from './delivery/delivery.service';
import { RateLimitService } from './delivery/rate-limit.service';
import { LoadsController } from './loads/loads.controller';
import { LoadsService } from './loads/loads.service';
import {
  BookingDirectory,
  DevFixtureBookingDirectory,
  UnavailableBookingDirectory,
} from './offplatform/booking-directory';
import {
  BookingOffPlatformReportsController,
  OffPlatformAdminController,
} from './offplatform/offplatform.controller';
import { OffPlatformBanService } from './offplatform/offplatform-ban.service';
import { OffPlatformReportService } from './offplatform/offplatform-report.service';

@Module({
  controllers: [
    AuthController,
    BillingController,
    CompaniesController,
    LoadsController,
    BookingOffPlatformReportsController,
    OffPlatformAdminController,
  ],
  providers: [
    { provide: ENV, useFactory: () => loadEnv(process.env, { purpose: 'api' }) },
    DbService,
    RateLimitService,
    DeliveryService,
    AuthService,
    CompaniesService,
    LoadsService,
    ReceivablesService,
    CommissionGateService,
    { provide: PAYMENT_PROVIDER, useClass: NoopPaymentProvider },
    OffPlatformBanService,
    OffPlatformReportService,
    {
      provide: BookingDirectory,
      useFactory: (env: Env) =>
        env.NODE_ENV !== 'production' && env.DEV_BOOKING_FIXTURES_FILE
          ? new DevFixtureBookingDirectory(env.DEV_BOOKING_FIXTURES_FILE)
          : new UnavailableBookingDirectory(),
      inject: [ENV],
    },
    JwtAuthGuard,
    AdminOnlyGuard,
  ],
})
export class AppModule {}
