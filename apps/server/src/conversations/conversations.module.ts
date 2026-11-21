import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatPersistenceProcessor } from './queue/chat-persistence.processor';
import { ConversationsService } from './conversations.service';
import { ConversationEventsService } from './conversation-events.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('redisUrl', 'redis://127.0.0.1:6379');
        try {
          const url = new URL(redisUrl);
          const host = !url.hostname || url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
          return {
            connection: {
              host,
              port: parseInt(url.port || '6379', 10),
              password: url.password ? decodeURIComponent(url.password) : undefined,
              username: url.username ? decodeURIComponent(url.username) : undefined,
              maxRetriesPerRequest: null,
              retryStrategy: (times: number) => Math.min(times * 500, 3000),
            },
          };
        } catch {
          return {
            connection: {
              host: '127.0.0.1',
              port: 6379,
              maxRetriesPerRequest: null,
              retryStrategy: (times: number) => Math.min(times * 500, 3000),
            },
          };
        }
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'chat-persistence',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    }),
  ],
  providers: [ConversationsService, ConversationEventsService, ChatPersistenceProcessor],
  exports: [BullModule, ConversationsService, ConversationEventsService],
})
export class ConversationsModule {}
