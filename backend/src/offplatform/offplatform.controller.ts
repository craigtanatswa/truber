import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminOnlyGuard } from '../common/admin-only.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest, singleHeader } from '../common/http';
import { OffPlatformBanService } from './offplatform-ban.service';
import {
  CreateOffPlatformReportDto,
  LiftOffPlatformBanDto,
  ListOffPlatformBansQueryDto,
  ListOffPlatformReportsQueryDto,
  RecordOffPlatformFindingDto,
} from './offplatform.dto';
import { OffPlatformReportService } from './offplatform-report.service';

@Controller('bookings/:bookingId/off-platform-reports')
@UseGuards(JwtAuthGuard)
export class BookingOffPlatformReportsController {
  constructor(private readonly reports: OffPlatformReportService) {}

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: CreateOffPlatformReportDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.reports.create(
      req.user,
      bookingId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class OffPlatformAdminController {
  constructor(
    private readonly reports: OffPlatformReportService,
    private readonly bans: OffPlatformBanService,
  ) {}

  @Get('off-platform-reports')
  listReports(@Query() query: ListOffPlatformReportsQueryDto) {
    return this.reports.list(query);
  }

  @Get('off-platform-reports/:reportId')
  getReport(@Param('reportId', new ParseUUIDPipe()) reportId: string) {
    return this.reports.get(reportId);
  }

  @Post('off-platform-reports/:reportId/finding')
  async recordFinding(
    @Req() req: AuthedRequest,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Body() body: RecordOffPlatformFindingDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.reports.recordFinding(
      req.user,
      reportId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Get('off-platform-bans')
  listBans(@Query() query: ListOffPlatformBansQueryDto) {
    return this.bans.list(query);
  }

  @Post('off-platform-bans/:banId/lift')
  async liftBan(
    @Req() req: AuthedRequest,
    @Param('banId', new ParseUUIDPipe()) banId: string,
    @Body() body: LiftOffPlatformBanDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.bans.liftWithIdempotency(
      req.user.id,
      banId,
      body.liftReason,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}
