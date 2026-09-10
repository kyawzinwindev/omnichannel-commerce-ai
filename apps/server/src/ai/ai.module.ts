import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { LlmService } from './llm.service';

@Module({
  providers: [EmbeddingsService, LlmService],
  exports: [EmbeddingsService, LlmService],
})
export class AiModule {}
