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
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest, singleHeader } from '../common/http';
import { AcceptQuotationDto, CreateQuotationDto, ListQuotationsQueryDto } from './quotations.dto';
import { QuotationsService } from './quotations.service';

@Controller('loads/:loadId/quotations')
@UseGuards(JwtAuthGuard)
export class LoadQuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Param('loadId', new ParseUUIDPipe()) loadId: string,
    @Query() query: ListQuotationsQueryDto,
  ) {
    return this.quotations.list(req.user, loadId, query);
  }

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Param('loadId', new ParseUUIDPipe()) loadId: string,
    @Body() body: CreateQuotationDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.quotations.create(
      req.user,
      loadId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}

@Controller('quotations')
@UseGuards(JwtAuthGuard)
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get(':quotationId')
  get(@Req() req: AuthedRequest, @Param('quotationId', new ParseUUIDPipe()) quotationId: string) {
    return this.quotations.get(req.user, quotationId);
  }

  @Post(':quotationId/withdraw')
  async withdraw(
    @Req() req: AuthedRequest,
    @Param('quotationId', new ParseUUIDPipe()) quotationId: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.quotations.withdraw(
      req.user,
      quotationId,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }

  @Post(':quotationId/accept')
  async accept(
    @Req() req: AuthedRequest,
    @Param('quotationId', new ParseUUIDPipe()) quotationId: string,
    @Body() body: AcceptQuotationDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.quotations.accept(
      req.user,
      quotationId,
      body ?? {},
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}
