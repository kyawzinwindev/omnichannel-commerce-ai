import { Body, Controller, HttpCode, HttpStatus, MessageEvent, Post, Sse } from '@nestjs/common';
import { ChatService, ChatResponse } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { Observable } from 'rxjs';

@Controller('api')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Standard REST endpoint for synchronous AI chat responses
   * POST /api/chat & POST /api/v1/chat
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async handleChat(@Body() dto: ChatRequestDto): Promise<ChatResponse> {
    return await this.chatService.processMessage(
      dto.tenantId,
      dto.message,
      dto.conversationId,
    );
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
