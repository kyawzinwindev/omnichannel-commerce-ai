import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private pipelineInstance: any = null;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2';

  async onModuleInit() {
    // Optionally warm-up / initialize the pipeline in background
    this.initPipeline().catch((err) => {
      this.logger.warn(`Deferred embeddings model load: ${err.message}`);
    });
  }

  private async initPipeline() {
    if (!this.pipelineInstance) {
      this.logger.log(`Loading embeddings model: ${this.modelName}...`);
      const { pipeline } = await import('@xenova/transformers');
      this.pipelineInstance = await pipeline('feature-extraction', this.modelName, {
        quantized: true,
      });
      this.logger.log(`Embeddings model ${this.modelName} loaded successfully.`);
    }
    return this.pipelineInstance;
  }

  /**
   * Generates a 384-dimensional normalized dense embedding vector for the given text.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const extractor = await this.initPipeline();
    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data);
  }

  /**
   * Batch embedding generation
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.generateEmbedding(text));
    }
    return results;
  }
}
