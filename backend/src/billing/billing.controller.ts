import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest, singleHeader } from '../common/http';
import { RecordCommissionCollectionDto } from './billing.dto';
import { ReceivablesService } from './receivables.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get('companies/:companyId/commission-account')
  getCompanyCommissionAccount(
    @Req() req: AuthedRequest,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
  ) {
    return this.receivables.accountFor(req.user, companyId);
  }

  @Post('admin/companies/:companyId/commission-collections')
  @HttpCode(201)
  recordCommissionCollection(
    @Req() req: AuthedRequest,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: RecordCommissionCollectionDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.receivables.recordCollectionForAdmin(
      req.user,
      companyId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
  }
}
