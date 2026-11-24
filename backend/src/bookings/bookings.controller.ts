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
import { AuthedRequest, singleHeader } from '../common/http';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { BookingsService } from './bookings.service';
import { DisputesService } from './disputes.service';
import {
  AcceptDisputeSettlementDto,
  CancelBookingDto,
  ConfirmBookingDto,
  ConfirmDeliveryDto,
  ListBookingsQueryDto,
  RaiseDisputeDto,
  RecordBookingAdjustmentDto,
  ResolveDisputeDto,
  RespondToDisputeDto,
  UpdateTripStatusDto,
} from './bookings.dto';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly disputes: DisputesService,
  ) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListBookingsQueryDto) {
    return this.bookings.list(req.user, query);
  }

  @Get(':bookingId')
  get(@Req() req: AuthedRequest, @Param('bookingId', new ParseUUIDPipe()) bookingId: string) {
    return this.bookings.get(req.user, bookingId);
  }

  @Post(':bookingId/trip-status')
  async updateTripStatus(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: UpdateTripStatusDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.bookings.updateTripStatus(
      req.user,
      bookingId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Post(':bookingId/confirm')
  async confirm(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: ConfirmBookingDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.bookings.confirm(
      req.user,
      bookingId,
      body ?? {},
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Post(':bookingId/cancel')
  async cancel(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: CancelBookingDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.bookings.cancel(
      req.user,
      bookingId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Get(':bookingId/delivery-confirmation')
  getDeliveryConfirmation(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ) {
    return this.bookings.getDeliveryConfirmation(req.user, bookingId);
  }

  @Post(':bookingId/delivery-confirmation')
  async confirmDelivery(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: ConfirmDeliveryDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.bookings.confirmDelivery(
      req.user,
      bookingId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Get(':bookingId/disputes')
  listDisputes(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ) {
    return this.disputes.list(req.user, bookingId);
  }

  @Post(':bookingId/disputes')
  async raiseDispute(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: RaiseDisputeDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.disputes.raise(
      req.user,
      bookingId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Post(':bookingId/disputes/resolve')
  async resolveDispute(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: ResolveDisputeDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.disputes.resolve(
      req.user,
      bookingId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}

@Controller('admin/bookings')
@UseGuards(JwtAuthGuard)
export class AdminBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post(':bookingId/adjustments')
  async recordAdjustment(
    @Req() req: AuthedRequest,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: RecordBookingAdjustmentDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.bookings.recordAdjustment(
      req.user,
      bookingId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post(':disputeId/response')
  async respond(
    @Req() req: AuthedRequest,
    @Param('disputeId', new ParseUUIDPipe()) disputeId: string,
    @Body() body: RespondToDisputeDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.disputes.respond(
      req.user,
      disputeId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Post(':disputeId/settlement')
  async settle(
    @Req() req: AuthedRequest,
    @Param('disputeId', new ParseUUIDPipe()) disputeId: string,
    @Body() body: AcceptDisputeSettlementDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.disputes.settle(
      req.user,
      disputeId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}
