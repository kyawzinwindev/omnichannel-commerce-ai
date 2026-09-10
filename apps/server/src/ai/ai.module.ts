import { Global, Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { LlmService } from './llm.service';
import { IntentService } from './intent.service';
import { VectorSearchService } from './vector-search.service';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Global()
@Module({
  controllers: [ChatController],
  providers: [EmbeddingsService, LlmService, IntentService, VectorSearchService, ChatService],
  exports: [EmbeddingsService, LlmService, IntentService, VectorSearchService, ChatService],
})
export class AiModule {}
