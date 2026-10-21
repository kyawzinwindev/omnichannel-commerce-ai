import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import { ChatService } from '../chat/chat.service';
import { ConversationsService } from '../conversations/conversations.service';

const WELCOME_MESSAGE =
  "👋 Welcome! I'm your AI shopping assistant.\n\n" +
  'Ask me about products, place an order, or track an existing one.\n' +
  'Try: "What do you sell?" or "Where is order 10492?"\n\n' +
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
    private readonly conversations: ConversationsService,
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

  /** Sends a plain-text message to a customer's Telegram chat (used by admin human takeover). */
  async sendMessage(chatId: string | number, text: string): Promise<void> {
    await this.bot.telegram.sendMessage(chatId, text);
  }

  isValidWebhookSecret(headerValue?: string): boolean {
    return !this.webhookSecret || headerValue === this.webhookSecret;
  }

  private registerHandlers() {
    this.bot.start((ctx) => ctx.reply(WELCOME_MESSAGE));

    this.bot.command('cancel', (ctx) => this.processAndReply(ctx, ctx.chat.id, 'cancel'));

    this.bot.on(message('text'), (ctx) =>
      this.processAndReply(ctx, ctx.chat.id, ctx.message.text),
    );

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

    try {
      await this.conversations.ensureConversation(this.tenantId, conversationId, {
        customerName: this.getCustomerName(ctx),
        username: ctx.from?.username,
      });

      // Human takeover: bypass the LLM entirely, store the message and notify the dashboard.
      if (await this.conversations.isHumanMode(this.tenantId, conversationId)) {
        await this.conversations.saveMessages(this.tenantId, conversationId, [
          { senderType: 'USER', content: text },
        ]);
        return;
      }

      await ctx.sendChatAction('typing').catch(() => undefined);

      // ChatService is the single source of truth for the message body.
      const { reply: replyText } = await this.chatService.processMessage(
        this.tenantId,
        text,
        conversationId,
      );

      await ctx.reply(replyText);
    } catch (err) {
      this.logger.error(`Failed to handle Telegram message from chat ${chatId}: ${err.message}`);
      await ctx
        .reply('Sorry, something went wrong. Please try again in a moment.')
        .catch(() => undefined);
    }
  }

  private getCustomerName(ctx: Context): string | undefined {
    const from = ctx.from;
    if (!from) return undefined;
    return [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username;
  }
}
