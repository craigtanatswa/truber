import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest } from '../common/http';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, ListCompaniesQueryDto, UpdateCompanyDto } from './companies.dto';

@Controller('companies')
@UseGuards(JwtAuthGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListCompaniesQueryDto) {
    return this.companies.list(req.user, query);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateCompanyDto) {
    return this.companies.create(req.user, body);
  }

  @Get(':companyId')
  get(@Req() req: AuthedRequest, @Param('companyId', new ParseUUIDPipe()) companyId: string) {
    return this.companies.get(req.user, companyId);
  }

  @Patch(':companyId')
  update(
    @Req() req: AuthedRequest,
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: UpdateCompanyDto,
  ) {
    return this.companies.update(req.user, companyId, body);
  }
}
