import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { LlmService } from './llm.service';
import { IntentService } from './intent.service';
import { VectorSearchService } from './vector-search.service';
import { ChatService } from './chat.service';

@Module({
  providers: [EmbeddingsService, LlmService, IntentService, VectorSearchService, ChatService],
  exports: [EmbeddingsService, LlmService, IntentService, VectorSearchService, ChatService],
})
export class AiModule {}
