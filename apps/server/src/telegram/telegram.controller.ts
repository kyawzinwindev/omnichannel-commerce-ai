import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { Update } from 'telegraf/types';
import { TelegramService } from './telegram.service';

@Controller('api/v1/telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    if (!this.telegramService.isValidWebhookSecret(secret)) {
      throw new ForbiddenException('Invalid webhook secret');
    }
    await this.telegramService.handleWebhookUpdate(update);
    return { ok: true };
  }
}
