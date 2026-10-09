import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { interval, map, merge, Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConversationEventsService } from '../conversations/conversation-events.service';
import { ConversationsService } from '../conversations/conversations.service';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { TelegramService } from '../telegram/telegram.service';
import { ListOrdersQueryDto, ListProductsQueryDto, ReplyDto, ToggleModeDto } from './dto/admin.dto';

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  private readonly tenantId: string;

  constructor(
    config: ConfigService,
    private readonly products: ProductsService,
    private readonly orders: OrdersService,
    private readonly conversations: ConversationsService,
    private readonly events: ConversationEventsService,
    private readonly telegram: TelegramService,
  ) {
    this.tenantId = config.get<string>('telegram.tenantId', 'demo-store-01');
  }

  @Get('products')
  listProducts(@Query() q: ListProductsQueryDto) {
    return this.products.list({ tenantId: this.tenantId, ...q });
  }

  @Get('orders')
  listOrders(@Query() q: ListOrdersQueryDto) {
    return this.orders.list({ tenantId: this.tenantId, ...q });
  }

  @Get('conversations')
  async listConversations() {
    return { data: await this.conversations.list(this.tenantId) };
  }

  /** Live updates (new messages, mode changes) for the dashboard. Auth via ?token= for EventSource. */
  @Sse('conversations/stream')
  stream(): Observable<MessageEvent> {
    const updates = this.events.events$.pipe(map((event) => ({ data: event }) as MessageEvent));
    const keepAlive = interval(25_000).pipe(map(() => ({ data: { type: 'ping' } }) as MessageEvent));
    return merge(updates, keepAlive);
  }

  @Get('conversations/:chatId/messages')
  async getMessages(@Param('chatId') chatId: string) {
    await this.assertExists(chatId);
    return { data: await this.conversations.getMessages(chatId) };
  }

  @Post('conversations/:chatId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@Param('chatId') chatId: string) {
    await this.conversations.markRead(chatId);
  }

  /** PATCH /api/v1/admin/conversations/:chatId/toggle-mode */
  @Patch('conversations/:chatId/toggle-mode')
  async toggleMode(@Param('chatId') chatId: string, @Body() dto: ToggleModeDto) {
    await this.assertExists(chatId);
    const target =
      dto.isHumanMode ?? !(await this.conversations.isHumanMode(this.tenantId, chatId));
    return { data: await this.conversations.setHumanMode(this.tenantId, chatId, target) };
  }

  /** POST /api/v1/admin/conversations/:chatId/reply — manual reply delivered via Telegram. */
  @Post('conversations/:chatId/reply')
  async reply(@Param('chatId') chatId: string, @Body() dto: ReplyDto) {
    await this.assertExists(chatId);
    if (!(await this.conversations.isHumanMode(this.tenantId, chatId))) {
      throw new ConflictException('Enable Human Mode before replying to this customer');
    }

    try {
      await this.telegram.sendMessage(chatId, dto.text);
    } catch (err) {
      throw new BadGatewayException(`Telegram delivery failed: ${err.message}`);
    }

    const [message] = await this.conversations.saveMessages(this.tenantId, chatId, [
      { senderType: 'AGENT', content: dto.text },
    ]);
    return { data: message };
  }

  private async assertExists(chatId: string) {
    if (!(await this.conversations.exists(chatId))) {
      throw new NotFoundException(`Conversation ${chatId} not found`);
    }
  }
}
