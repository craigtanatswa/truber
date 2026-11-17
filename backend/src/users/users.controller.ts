import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthedRequest } from '../common/http';
import { UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':userId')
  get(@Req() req: AuthedRequest, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.users.get(req.user, userId);
  }

  @Patch(':userId')
  update(
    @Req() req: AuthedRequest,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.users.update(req.user, userId, body);
  }
}
