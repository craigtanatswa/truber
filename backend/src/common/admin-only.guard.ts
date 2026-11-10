import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiException } from './api.exception';
import { AuthedRequest } from './http';

@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user?.role !== 'admin') {
      throw new ApiException(403, 'FORBIDDEN', 'Admin access required.');
    }
    return true;
  }
}
