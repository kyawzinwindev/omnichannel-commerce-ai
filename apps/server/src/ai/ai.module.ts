import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { LlmService } from './llm.service';
import { IntentService } from './intent.service';
import { VectorSearchService } from './vector-search.service';

@Module({
  providers: [EmbeddingsService, LlmService, IntentService, VectorSearchService],
  exports: [EmbeddingsService, LlmService, IntentService, VectorSearchService],
})
export class AiModule {}
