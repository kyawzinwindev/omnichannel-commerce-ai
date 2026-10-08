import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import { ChatService } from '../ai/chat.service';
import { RedisService } from '../redis/redis.service';
import {
  buildTelegramReply,
  CALLBACK_CANCEL_ORDER,
  CALLBACK_CONFIRM_ORDER,
  escapeHtml,
} from './telegram.formatter';

const WELCOME_MESSAGE =
  '👋 <b>Welcome!</b> I\'m your AI shopping assistant.\n\n' +
  'Ask me about products, place an order, or track an existing one.\n' +
  'Try: <i>"What do you sell?"</i> or <i>"Where is order 10492?"</i>\n\n' +
  'Send /cancel at any time to reset your order.';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf<Context>;
  private readonly tenantId: string;
  private readonly usePolling: boolean;
  private readonly webhookUrl: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly redisService: RedisService,
  ) {
    const token = this.configService.get<string>('telegram.botToken', '');
    this.tenantId = this.configService.get<string>('telegram.tenantId', 'demo-store-01');
    this.usePolling = this.configService.get<boolean>('telegram.usePolling', false);
    this.webhookUrl = this.configService.get<string>('telegram.webhookUrl', '');
    this.webhookSecret = this.configService.get<string>('telegram.webhookSecret', '');

    this.bot = new Telegraf(token);
    this.registerHandlers();
  }

  async onModuleInit() {
    try {
      if (this.usePolling) {
        // Webhook and polling are mutually exclusive in Telegram.
        await this.bot.telegram.deleteWebhook();
        // launch() resolves only when the bot stops, so do not await it.
        this.bot
          .launch()
          .catch((err) => this.logger.error(`Telegram polling stopped: ${err.message}`));
        this.logger.log('Telegram bot started in POLLING mode');
      } else {
        await this.bot.telegram.setWebhook(this.webhookUrl, {
          secret_token: this.webhookSecret || undefined,
        });
        this.logger.log(`Telegram webhook registered: ${this.webhookUrl}`);
      }
    } catch (err) {
      // Don't crash the whole API if Telegram is unreachable on boot.
      this.logger.error(`Failed to initialise Telegram bot: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.usePolling) {
      try {
        this.bot.stop('shutdown');
      } catch {
        /* bot was not running */
      }
    }
  }

  /** Entry point for POST /api/v1/telegram/webhook */
  async handleWebhookUpdate(update: Update) {
    await this.bot.handleUpdate(update);
  }

  isValidWebhookSecret(headerValue?: string): boolean {
    return !this.webhookSecret || headerValue === this.webhookSecret;
  }

  private registerHandlers() {
    this.bot.start((ctx) => ctx.replyWithHTML(WELCOME_MESSAGE));

    this.bot.command('cancel', (ctx) => this.processAndReply(ctx, ctx.chat.id, 'cancel'));

    this.bot.on(message('text'), (ctx) =>
      this.processAndReply(ctx, ctx.chat.id, ctx.message.text),
    );

    this.bot.on('callback_query', async (ctx) => {
      const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
      const chatId = ctx.chat?.id;
      await ctx.answerCbQuery().catch(() => undefined);
      if (!chatId) return;

      // Remove the buttons so an order can't be confirmed twice.
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);

      if (data === CALLBACK_CONFIRM_ORDER) {
        await this.processAndReply(ctx, chatId, 'confirm');
      } else if (data === CALLBACK_CANCEL_ORDER) {
        await this.processAndReply(ctx, chatId, 'cancel');
      }
    });

    this.bot.catch((err, ctx) => {
      this.logger.error(`Telegram handler error for update ${ctx.update.update_id}: ${err}`);
    });
  }

  /**
   * chat.id is used as both the session userId and the conversationId,
   * so Redis state (IDLE / COLLECTING_USER_INFO / CONFIRMING_ORDER) is per Telegram chat.
   */
  private async processAndReply(ctx: Context, chatId: number, text: string) {
    const conversationId = String(chatId);

    await ctx.sendChatAction('typing').catch(() => undefined);

    try {
      const response = await this.chatService.processMessage(this.tenantId, text, conversationId);
      const session = await this.redisService.getSessionState(this.tenantId, conversationId);
      const reply = buildTelegramReply(response, session);

      await ctx.replyWithHTML(reply.text, {
        reply_markup: reply.keyboard ? { inline_keyboard: reply.keyboard } : undefined,
      });
    } catch (err) {
      this.logger.error(`Failed to handle Telegram message from chat ${chatId}: ${err.message}`);
      await ctx
        .replyWithHTML(escapeHtml('Sorry, something went wrong. Please try again in a moment.'))
        .catch(() => undefined);
    }
  }
}
