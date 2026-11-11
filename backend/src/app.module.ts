import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
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
import { PostgresBookingDirectory } from './bookings/postgres-booking-directory';
import {
  BookingDirectory,
  DevFixtureBookingDirectory,
} from './offplatform/booking-directory';
import {
  BookingOffPlatformReportsController,
  OffPlatformAdminController,
} from './offplatform/offplatform.controller';
import { OffPlatformBanService } from './offplatform/offplatform-ban.service';
import { OffPlatformReportService } from './offplatform/offplatform-report.service';
import { NewWorkCommissionGate, NoCommissionRecordsGate } from './quotations/commission-gate';
import { LoadQuotationsController, QuotationsController } from './quotations/quotations.controller';
import { QuotationsService } from './quotations/quotations.service';
import { TruckQuoteCheck, UnavailableTruckQuoteCheck } from './quotations/truck-quote-check';

@Module({
  controllers: [
    AuthController,
    CompaniesController,
    LoadsController,
    LoadQuotationsController,
    QuotationsController,
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
    QuotationsService,
    OffPlatformBanService,
    OffPlatformReportService,
    {
      provide: BookingDirectory,
      useFactory: (env: Env) =>
        env.NODE_ENV !== 'production' && env.DEV_BOOKING_FIXTURES_FILE
          ? new DevFixtureBookingDirectory(env.DEV_BOOKING_FIXTURES_FILE)
          : new PostgresBookingDirectory(),
      inject: [ENV],
    },
    { provide: NewWorkCommissionGate, useClass: NoCommissionRecordsGate },
    { provide: TruckQuoteCheck, useClass: UnavailableTruckQuoteCheck },
    JwtAuthGuard,
    AdminOnlyGuard,
  ],
})
export class AppModule {}
