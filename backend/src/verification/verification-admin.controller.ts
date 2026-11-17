import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminOnlyGuard } from '../common/admin-only.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest, singleHeader } from '../common/http';
import { ReviewVerificationDocumentDto } from './verification.dto';
import { VerificationService } from './verification.service';

@Controller('admin/verification-documents')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class VerificationAdminController {
  constructor(private readonly verification: VerificationService) {}

  @Post(':documentId/review')
  async review(
    @Req() req: AuthedRequest,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() body: ReviewVerificationDocumentDto,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.verification.review(
      req.user,
      documentId,
      body,
      singleHeader(idempotencyKey, 'Idempotency-Key'),
    );
    res.status(result.status).json(result.body);
  }
}
