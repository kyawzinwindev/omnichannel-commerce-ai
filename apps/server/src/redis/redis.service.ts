import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { UserSessionState, ChatStage } from './session-state';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = this.configService.get<string>('redisUrl', 'redis://localhost:6379');
    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis instance.');
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis connection error: ${err.message}`);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`Error getting key ${key} from Redis: ${error.message}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.error(`Error setting key ${key} in Redis: ${error.message}`);
    }
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.client.rpush(key, ...values);
    } catch (error) {
      this.logger.error(`Error rpush to key ${key} in Redis: ${error.message}`);
      return 0;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lrange(key, start, stop);
    } catch (error) {
      this.logger.error(`Error lrange for key ${key} from Redis: ${error.message}`);
      return [];
    }
  }

  async expire(key: string, seconds: number): Promise<number> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      this.logger.error(`Error setting expire on key ${key} in Redis: ${error.message}`);
      return 0;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error(`Error deleting key ${key} from Redis: ${error.message}`);
    }
  }

  /**
   * Retrieves conversation session state from Redis.
   * Returns a default IDLE session if not found.
   */
  async getSessionState(tenantId: string, sessionId: string): Promise<UserSessionState> {
    const key = `session:state:${tenantId}:${sessionId}`;
    const raw = await this.get(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return {
          stage: parsed.stage || ChatStage.IDLE,
          cart: parsed.cart || [],
          draftOrder: parsed.draftOrder || {},
          lastUpdated: parsed.lastUpdated,
        };
      } catch (err) {
        this.logger.warn(`Failed to parse session state for ${key}: ${err.message}`);
      }
    }
    return {
      stage: ChatStage.IDLE,
      cart: [],
      draftOrder: {},
    };
  }

  /**
   * Persists conversation session state in Redis with TTL.
   */
  async setSessionState(
    tenantId: string,
    sessionId: string,
    state: UserSessionState,
    ttlSeconds = 86400, // 24 hours
  ): Promise<void> {
    const key = `session:state:${tenantId}:${sessionId}`;
    const payload: UserSessionState = {
      ...state,
      lastUpdated: Date.now(),
    };
    await this.set(key, JSON.stringify(payload), ttlSeconds);
  }

  /**
   * Clears conversation session state in Redis.
   */
  async clearSessionState(tenantId: string, sessionId: string): Promise<void> {
    const key = `session:state:${tenantId}:${sessionId}`;
    await this.del(key);
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
