import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

/**
 * Accepts `Authorization: Bearer <jwt>`; also accepts `?token=<jwt>` because the browser
 * EventSource API (used for the live SSE stream) cannot send custom headers.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = request.headers.authorization;
    const token =
      header?.startsWith('Bearer ') ? header.slice(7) : (request.query?.token as string | undefined);

    if (!token) throw new UnauthorizedException('Missing access token');

    try {
      request.user = await this.authService.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
