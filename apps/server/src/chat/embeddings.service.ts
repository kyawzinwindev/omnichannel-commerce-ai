import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private pipelineInstance: any = null;
  private pipelinePromise: Promise<any> | null = null;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2';

  async onModuleInit() {
    try {
      this.logger.log(`Warming up embeddings model: ${this.modelName}...`);
      const extractor = await this.initPipeline();
      // Perform warm-up inference to prime memory & tokenizer
      await extractor('warmup search query', {
        pooling: 'mean',
        normalize: true,
      });
      this.logger.log(`Embeddings model ${this.modelName} loaded and warmed up successfully.`);
    } catch (err) {
      this.logger.warn(`Embeddings model load/warmup warning: ${err.message}`);
    }
  }

  private async initPipeline() {
    if (this.pipelineInstance) {
      return this.pipelineInstance;
    }

    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        this.logger.log(`Loading embeddings model: ${this.modelName}...`);
        const { pipeline } = await import('@xenova/transformers');
        const instance = await pipeline('feature-extraction', this.modelName, {
          quantized: true,
        });
        this.pipelineInstance = instance;
        return instance;
      })();
    }

    return this.pipelinePromise;
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

