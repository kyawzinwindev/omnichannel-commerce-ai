import { Body, Controller, HttpCode, HttpStatus, MessageEvent, Post, Sse } from '@nestjs/common';
import { ChatService, ChatResponse } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { Observable } from 'rxjs';

@Controller('api/v1/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Standard REST endpoint for synchronous AI chat responses
   * POST /api/v1/chat
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleChat(@Body() dto: ChatRequestDto): Promise<ChatResponse> {
    return await this.chatService.processMessage(
      dto.tenantId,
      dto.message,
      dto.history || [],
    );
  }

  /**
   * Server-Sent Events (SSE) streaming endpoint for real-time token generation
   * POST /api/v1/chat/stream
   */
  @Post('stream')
  @Sse()
  streamChat(@Body() dto: ChatRequestDto): Observable<MessageEvent> {
    return this.chatService.streamMessage(
      dto.tenantId,
      dto.message,
      dto.history || [],
    );
  }
}
