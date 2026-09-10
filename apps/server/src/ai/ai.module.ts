import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { LlmService } from './llm.service';
import { IntentService } from './intent.service';

@Module({
  providers: [EmbeddingsService, LlmService, IntentService],
  exports: [EmbeddingsService, LlmService, IntentService],
})
export class AiModule {}
