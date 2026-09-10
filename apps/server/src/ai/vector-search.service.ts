import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingsService } from './embeddings.service';

export interface ScoredProduct {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  attributes: any;
  similarity: number;
}

@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  /**
   * Performs vector similarity search (cosine similarity: 1 - (embedding <=> queryVector))
   * filtered by merchant/tenant ID.
   */
  async searchSimilarProducts(
    tenantId: string,
    query: string,
    limit = 5,
    similarityThreshold = 0.3,
  ): Promise<ScoredProduct[]> {
    try {
      const queryEmbedding = await this.embeddingsService.generateEmbedding(query);
      return await this.searchByVector(tenantId, queryEmbedding, limit, similarityThreshold);
    } catch (error) {
      this.logger.error(`Vector search failed for query "${query}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Executes cosine similarity search with a raw vector embedding.
   */
  async searchByVector(
    tenantId: string,
    queryVector: number[],
    limit = 5,
    similarityThreshold = 0.3,
  ): Promise<ScoredProduct[]> {
    const vectorString = `[${queryVector.join(',')}]`;

    const results = await this.prisma.$queryRaw<ScoredProduct[]>`
      SELECT 
        id,
        tenant_id,
        name,
        description,
        price::float as price,
        category,
        attributes,
        1 - (embedding <=> ${vectorString}::vector) AS similarity
      FROM products
      WHERE tenant_id = ${tenantId}
        AND embedding IS NOT NULL
        AND (1 - (embedding <=> ${vectorString}::vector)) >= ${similarityThreshold}
      ORDER BY embedding <=> ${vectorString}::vector ASC
      LIMIT ${limit};
    `;

    return results;
  }
}
