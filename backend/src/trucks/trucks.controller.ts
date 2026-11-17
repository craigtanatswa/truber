import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest } from '../common/http';
import { CreateTruckDto, ListTrucksQueryDto, UpdateTruckDto } from './trucks.dto';
import { TrucksService } from './trucks.service';

@Controller('trucks')
@UseGuards(JwtAuthGuard)
export class TrucksController {
  constructor(private readonly trucks: TrucksService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListTrucksQueryDto) {
    return this.trucks.list(req.user, query);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: CreateTruckDto) {
    return this.trucks.create(req.user, body);
  }

  @Get(':truckId')
  get(@Req() req: AuthedRequest, @Param('truckId', new ParseUUIDPipe()) truckId: string) {
    return this.trucks.get(req.user, truckId);
  }

  @Patch(':truckId')
  update(
    @Req() req: AuthedRequest,
    @Param('truckId', new ParseUUIDPipe()) truckId: string,
    @Body() body: UpdateTruckDto,
  ) {
    return this.trucks.update(req.user, truckId, body);
  }
}
