import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { ProductSearchFilters } from '../products/interfaces/store-provider.interface';

export interface ScoredProduct {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  price: number;
  brand: string | null;
  target_gender: string | null;
  category_type: string | null;
  stock: number;
  colors: string[] | null;
  sizes: string[] | null;
  attributes: any;
  similarity: number;
  rrf_score?: number;
}

const GENDER_MAP: Record<string, 'MEN' | 'WOMEN' | 'UNISEX'> = {
  men: 'MEN',
  "men's": 'MEN',
  mens: 'MEN',
  male: 'MEN',
  man: 'MEN',
  women: 'WOMEN',
  "women's": 'WOMEN',
  womens: 'WOMEN',
  female: 'WOMEN',
  woman: 'WOMEN',
  ladies: 'WOMEN',
  unisex: 'UNISEX',
};

const CATEGORY_MAP: Record<string, string> = {
  pant: 'Pants',
  pants: 'Pants',
  trouser: 'Pants',
  trousers: 'Pants',
  jogger: 'Pants',
  joggers: 'Pants',
  sweatpant: 'Pants',
  sweatpants: 'Pants',
  cargo: 'Pants',
  'cargo pants': 'Pants',
  short: 'Shorts',
  shorts: 'Shorts',
  't-shirt': 'T-Shirts',
  't-shirts': 'T-Shirts',
  tshirt: 'T-Shirts',
  tshirts: 'T-Shirts',
  tee: 'T-Shirts',
  tees: 'T-Shirts',
  shirt: 'T-Shirts',
  shirts: 'T-Shirts',
  hoodie: 'Hoodies',
  hoodies: 'Hoodies',
  sweatshirt: 'Hoodies',
  sweatshirts: 'Hoodies',
  jacket: 'Jackets',
  jackets: 'Jackets',
  windbreaker: 'Jackets',
  coat: 'Jackets',
  coats: 'Jackets',
  dress: 'Dresses',
  dresses: 'Dresses',
};

export function normalizeGenderFilter(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const k = raw.trim().toLowerCase();
  return GENDER_MAP[k] ?? raw.trim().toUpperCase();
}

export function normalizeCategoryFilter(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const k = raw.trim().toLowerCase();
  return CATEGORY_MAP[k] ?? raw.trim();
}

export function normalizeBrandFilter(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  return raw.trim();
}

@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  /**
   * Executes Hybrid Search (pgvector cosine similarity + PostgreSQL full-text tsvector/ts_rank_cd)
   * fused with Reciprocal Rank Fusion (RRF, k = 60) and optional metadata pre-filtering.
   */
  async searchSimilarProducts(
    tenantId: string,
    query: string,
    limit = 5,
    similarityThreshold = 0.25,
    filters?: ProductSearchFilters,
  ): Promise<ScoredProduct[]> {
    try {
      const effectiveQuery =
        query && query.trim()
          ? query.trim()
          : [filters?.brand, filters?.targetGender, filters?.categoryType].filter(Boolean).join(' ') || 'apparel';
      const queryEmbedding = await this.embeddingsService.generateEmbedding(effectiveQuery);
      return await this.searchHybridByVector(
        tenantId,
        effectiveQuery,
        queryEmbedding,
        limit,
        similarityThreshold,
        filters,
      );
    } catch (error) {
      this.logger.error(`Hybrid vector search failed for query "${query}": ${error.message}`);
      throw error;
    }
  }

  /**
   * Runs the dual-CTE (semantic_search + keyword_search) Reciprocal Rank Fusion SQL query
   * with structured metadata pre-filters (brand, target_gender, category_type).
   */
  private async searchHybridByVector(
    tenantId: string,
    query: string,
    queryVector: number[],
    limit = 5,
    similarityThreshold = 0.25,
    filters?: ProductSearchFilters,
  ): Promise<ScoredProduct[]> {
    const vectorString = `[${queryVector.join(',')}]`;
    const brandFilter = normalizeBrandFilter(filters?.brand);
    const genderFilter = normalizeGenderFilter(filters?.targetGender);
    const categoryFilter = normalizeCategoryFilter(filters?.categoryType);
    const cleanQuery = query.trim();
    const likePattern = `%${cleanQuery}%`;
    const candidateLimit = Math.max(limit * 4, 20);

    const results = await this.prisma.$queryRaw<ScoredProduct[]>`
      WITH filtered_products AS (
        SELECT
          id,
          tenant_id,
          name,
          description,
          price::float AS price,
          brand,
          target_gender::text AS target_gender,
          category_type,
          stock,
          colors,
          sizes,
          attributes,
          embedding
        FROM products
        WHERE tenant_id = ${tenantId}
          AND (${brandFilter}::text IS NULL OR LOWER(brand) = LOWER(${brandFilter}))
          AND (
            ${genderFilter}::text IS NULL
            OR LOWER(target_gender::text) = LOWER(${genderFilter})
            OR LOWER(target_gender::text) = 'unisex'
          )
          AND (${categoryFilter}::text IS NULL OR LOWER(category_type) = LOWER(${categoryFilter}))
      ),
      semantic_search AS (
        SELECT
          id,
          (1 - (embedding <=> ${vectorString}::vector))::float AS similarity,
          ROW_NUMBER() OVER (ORDER BY embedding <=> ${vectorString}::vector ASC) AS semantic_rank
        FROM filtered_products
        WHERE embedding IS NOT NULL
          AND (1 - (embedding <=> ${vectorString}::vector)) >= ${similarityThreshold}
        ORDER BY embedding <=> ${vectorString}::vector ASC
        LIMIT ${candidateLimit}
      ),
      keyword_search AS (
        SELECT
          id,
          (
            ts_rank_cd(
              to_tsvector(
                'english',
                coalesce(name, '') || ' ' ||
                coalesce(brand, '') || ' ' ||
                coalesce(category_type, '') || ' ' ||
                coalesce(description, '')
              ),
              plainto_tsquery('english', ${cleanQuery})
            ) +
            CASE
              WHEN name ILIKE ${likePattern} THEN 0.5
              WHEN coalesce(brand, '') ILIKE ${likePattern}
                OR coalesce(category_type, '') ILIKE ${likePattern}
                OR coalesce(description, '') ILIKE ${likePattern} THEN 0.25
              ELSE 0.0
            END
          )::float AS kw_score,
          ROW_NUMBER() OVER (
            ORDER BY
              (
                ts_rank_cd(
                  to_tsvector(
                    'english',
                    coalesce(name, '') || ' ' ||
                    coalesce(brand, '') || ' ' ||
                    coalesce(category_type, '') || ' ' ||
                    coalesce(description, '')
                  ),
                  plainto_tsquery('english', ${cleanQuery})
                ) +
                CASE
                  WHEN name ILIKE ${likePattern} THEN 0.5
                  WHEN coalesce(brand, '') ILIKE ${likePattern}
                    OR coalesce(category_type, '') ILIKE ${likePattern}
                    OR coalesce(description, '') ILIKE ${likePattern} THEN 0.25
                  ELSE 0.0
                END
              ) DESC,
              name ASC
          ) AS keyword_rank
        FROM filtered_products
        WHERE (
          to_tsvector(
            'english',
            coalesce(name, '') || ' ' ||
            coalesce(brand, '') || ' ' ||
            coalesce(category_type, '') || ' ' ||
            coalesce(description, '')
          ) @@ plainto_tsquery('english', ${cleanQuery})
          OR name ILIKE ${likePattern}
          OR coalesce(brand, '') ILIKE ${likePattern}
          OR coalesce(category_type, '') ILIKE ${likePattern}
          OR coalesce(description, '') ILIKE ${likePattern}
        )
        LIMIT ${candidateLimit}
      ),
      rrf_combined AS (
        SELECT
          COALESCE(s.id, k.id) AS id,
          COALESCE(s.similarity, 0.0)::float AS similarity,
          (
            COALESCE(1.0 / (60 + s.semantic_rank), 0.0) +
            COALESCE(1.0 / (60 + k.keyword_rank), 0.0)
          )::float AS rrf_score
        FROM semantic_search s
        FULL OUTER JOIN keyword_search k ON s.id = k.id
      )
      SELECT
        p.id,
        p.tenant_id,
        p.name,
        p.description,
        p.price,
        p.brand,
        p.target_gender,
        p.category_type,
        p.stock,
        p.colors,
        p.sizes,
        p.attributes,
        r.similarity,
        r.rrf_score
      FROM filtered_products p
      INNER JOIN rrf_combined r ON p.id = r.id
      ORDER BY r.rrf_score DESC, r.similarity DESC
      LIMIT ${limit};
    `;

    return results;
  }
}
