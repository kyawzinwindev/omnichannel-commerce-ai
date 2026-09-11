import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ChatMessage,
} from '@langchain/core/messages';
import { RedisService } from './redis.service';
import { PrismaService } from '../database/prisma.service';
import { Logger } from '@nestjs/common';

export interface RedisChatMessageHistoryOptions {
  tenantId: string;
  conversationId: string;
  redisService: RedisService;
  prisma?: PrismaService;
  ttlSeconds?: number;
}

interface StoredRedisMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class RedisChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ['langchain', 'stores', 'message', 'redis'];

  private readonly logger = new Logger(RedisChatMessageHistory.name);
  private readonly tenantId: string;
  private readonly conversationId: string;
  private readonly redisService: RedisService;
  private readonly prisma?: PrismaService;
  private readonly ttlSeconds: number;
  private readonly redisKey: string;

  constructor(options: RedisChatMessageHistoryOptions) {
    super();
    this.tenantId = options.tenantId;
    this.conversationId = options.conversationId;
    this.redisService = options.redisService;
    this.prisma = options.prisma;
    this.ttlSeconds = options.ttlSeconds ?? 86400; // 24 hours default TTL
    this.redisKey = `chat:history:${this.tenantId}:${this.conversationId}`;
  }

  /**
   * Retrieves messages from Redis cache.
   * If cache is empty and PrismaService is available, falls back to PostgreSQL and warms Redis.
   */
  async getMessages(): Promise<BaseMessage[]> {
    try {
      const rawMessages = await this.redisService.lrange(this.redisKey, 0, -1);

      if (rawMessages && rawMessages.length > 0) {
        return rawMessages.map((raw) => {
          try {
            const parsed: StoredRedisMessage = JSON.parse(raw);
            return this.mapStoredMessageToBaseMessage(parsed);
          } catch {
            return new HumanMessage(raw);
          }
        });
      }

      // Cache miss -> Fallback to PostgreSQL if PrismaService is available
      if (this.prisma) {
        const dbMessages = await this.prisma.message.findMany({
          where: { conversationId: this.conversationId },
          orderBy: { createdAt: 'asc' },
          take: 50,
        });

        if (dbMessages.length > 0) {
          const messagesToCache: string[] = [];
          const baseMessages: BaseMessage[] = [];

          for (const msg of dbMessages) {
            const role =
              msg.senderType === 'USER'
                ? 'user'
                : msg.senderType === 'ASSISTANT'
                  ? 'assistant'
                  : 'system';

            const storedMsg: StoredRedisMessage = {
              role,
              content: msg.content,
            };

            messagesToCache.push(JSON.stringify(storedMsg));
            baseMessages.push(this.mapStoredMessageToBaseMessage(storedMsg));
          }

          if (messagesToCache.length > 0) {
            await this.redisService.rpush(this.redisKey, ...messagesToCache);
            await this.redisService.expire(this.redisKey, this.ttlSeconds);
          }

          return baseMessages;
        }
      }

      return [];
    } catch (error) {
      this.logger.error(`Error retrieving messages from Redis (${this.redisKey}): ${error.message}`);
      return [];
    }
  }

  /**
   * Appends a message to the Redis chat history and refreshes the key's TTL.
   */
  async addMessage(message: BaseMessage): Promise<void> {
    try {
      const storedMsg: StoredRedisMessage = {
        role: this.mapBaseMessageTypeToRole(message),
        content:
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content),
      };

      await this.redisService.rpush(this.redisKey, JSON.stringify(storedMsg));
      await this.redisService.expire(this.redisKey, this.ttlSeconds);
    } catch (error) {
      this.logger.error(`Error adding message to Redis (${this.redisKey}): ${error.message}`);
    }
  }

  /**
   * Appends multiple messages to the Redis chat history in batch.
   */
  async addMessages(messages: BaseMessage[]): Promise<void> {
    if (!messages || messages.length === 0) return;

    try {
      const serialized = messages.map((m) => {
        const storedMsg: StoredRedisMessage = {
          role: this.mapBaseMessageTypeToRole(m),
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        };
        return JSON.stringify(storedMsg);
      });

      await this.redisService.rpush(this.redisKey, ...serialized);
      await this.redisService.expire(this.redisKey, this.ttlSeconds);
    } catch (error) {
      this.logger.error(`Error adding messages batch to Redis (${this.redisKey}): ${error.message}`);
    }
  }

  /**
   * Clears the conversation key from Redis.
   */
  async clear(): Promise<void> {
    try {
      await this.redisService.del(this.redisKey);
    } catch (error) {
      this.logger.error(`Error clearing Redis chat history for ${this.redisKey}: ${error.message}`);
    }
  }

  private mapStoredMessageToBaseMessage(stored: StoredRedisMessage): BaseMessage {
    switch (stored.role) {
      case 'user':
        return new HumanMessage(stored.content);
      case 'assistant':
        return new AIMessage(stored.content);
      case 'system':
        return new SystemMessage(stored.content);
      default:
        return new ChatMessage(stored.content, stored.role);
    }
  }

  private mapBaseMessageTypeToRole(message: BaseMessage): 'user' | 'assistant' | 'system' {
    const type = message._getType();
    if (type === 'human') return 'user';
    if (type === 'ai') return 'assistant';
    if (type === 'system') return 'system';
    return 'user';
  }
}
