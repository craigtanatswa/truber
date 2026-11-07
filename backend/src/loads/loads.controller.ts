import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest, singleHeader } from '../common/http';
import { CancelLoadDto, CreateLoadDto, ListLoadsQueryDto, UpdateLoadDto } from './loads.dto';
import { LoadsService } from './loads.service';

@Controller('loads')
@UseGuards(JwtAuthGuard)
export class LoadsController {
  constructor(private readonly loads: LoadsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListLoadsQueryDto) {
    return this.loads.list(req.user, query);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateLoadDto) {
    return this.loads.create(req.user, body);
  }

  @Get(':loadId')
  get(@Req() req: AuthedRequest, @Param('loadId', new ParseUUIDPipe()) loadId: string) {
    return this.loads.get(req.user, loadId);
  }

  @Patch(':loadId')
  update(
    @Req() req: AuthedRequest,
    @Param('loadId', new ParseUUIDPipe()) loadId: string,
    @Body() body: UpdateLoadDto,
  ) {
    return this.loads.update(req.user, loadId, body);
  }

  @Post(':loadId/post')
  @HttpCode(200)
  async post(
    @Req() req: AuthedRequest,
    @Param('loadId', new ParseUUIDPipe()) loadId: string,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.loads.post(req.user, loadId, singleHeader(idempotencyKey, 'Idempotency-Key'));
    res.status(result.status).json(result.body);
  }

  @Post(':loadId/cancel')
  @HttpCode(200)
  async cancel(
    @Req() req: AuthedRequest,
    @Param('loadId', new ParseUUIDPipe()) loadId: string,
    @Body() body: CancelLoadDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.loads.cancel(req.user, loadId, body ?? {}, singleHeader(idempotencyKey, 'Idempotency-Key'));
    res.status(result.status).json(result.body);
  }
}
