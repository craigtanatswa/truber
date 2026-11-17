import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest } from '../common/http';
import { CreateVerificationDocumentDto, ListVerificationDocumentsQueryDto } from './verification.dto';
import { VerificationService } from './verification.service';

@Controller('verification-documents')
@UseGuards(JwtAuthGuard)
export class VerificationDocumentsController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListVerificationDocumentsQueryDto) {
    return this.verification.list(req.user, query);
  }

  @Post()
  upload(@Req() req: AuthedRequest, @Body() body: CreateVerificationDocumentDto) {
    return this.verification.upload(req.user, body);
  }
}
