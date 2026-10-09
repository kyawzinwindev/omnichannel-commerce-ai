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
        const redisUrl = configService.get<string>('redisUrl', 'redis://localhost:6379');
        try {
          const url = new URL(redisUrl);
          return {
            connection: {
              host: url.hostname || 'localhost',
              port: parseInt(url.port || '6379', 10),
              password: url.password ? decodeURIComponent(url.password) : undefined,
              username: url.username ? decodeURIComponent(url.username) : undefined,
              maxRetriesPerRequest: null,
            },
          };
        } catch {
          return {
            connection: { host: 'localhost', port: 6379, maxRetriesPerRequest: null },
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
