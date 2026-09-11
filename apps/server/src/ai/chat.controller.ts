import { Body, Controller, HttpCode, HttpStatus, MessageEvent, Post, Sse, Logger } from '@nestjs/common';
import { ChatService, ChatResponse } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';

@Controller('api')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  /**
   * Standard REST endpoint for synchronous AI chat responses
   * POST /api/chat & POST /api/v1/chat
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async handleChat(@Body() dto: ChatRequestDto): Promise<ChatResponse> {
    try {
      return await this.chatService.processMessage(
        dto.tenantId,
        dto.message,
        dto.conversationId,
      );
    } catch (error) {
      this.logger.warn(`Unhandled controller error in handleChat: ${error.message}`);
      return {
        conversationId: dto.conversationId || randomUUID(),
        intent: 'UNKNOWN' as any,
        confidence: 0.0,
        reply:
          "Hello! I am your AI store assistant. I'm currently having trouble connecting to all catalog systems, but I'm here to assist you. How can I help today?",
        products: [],
        suggestedProducts: [],
        orderTimeline: null,
      };
    }
  }

  /**
   * Server-Sent Events (SSE) streaming endpoint for real-time token generation
   * POST /api/chat/stream
   */
  @Post('chat/stream')
  @Sse()
  streamChat(@Body() dto: ChatRequestDto): Observable<MessageEvent> {
    return this.chatService.streamMessage(
      dto.tenantId,
      dto.message,
      dto.conversationId,
    );
  }

  // Backward compatibility alias for /api/v1/chat
  @Post('v1/chat')
  @HttpCode(HttpStatus.OK)
  async handleChatV1(@Body() dto: ChatRequestDto): Promise<ChatResponse> {
    return await this.handleChat(dto);
  }

  @Post('v1/chat/stream')
  @Sse()
  streamChatV1(@Body() dto: ChatRequestDto): Observable<MessageEvent> {
    return this.streamChat(dto);
  }
}
