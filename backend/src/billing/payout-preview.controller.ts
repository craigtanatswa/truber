import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest } from '../common/http';
import { PayoutPreviewDto } from './payout-preview.dto';
import { PayoutPreviewService } from './payout-preview.service';

@Controller('quotations')
@UseGuards(JwtAuthGuard)
export class PayoutPreviewController {
  constructor(private readonly previews: PayoutPreviewService) {}

  @Post('payout-preview')
  @HttpCode(200)
  previewQuotationPayout(@Req() req: AuthedRequest, @Body() body: PayoutPreviewDto) {
    return this.previews.preview(req.user, body);
  }
}
