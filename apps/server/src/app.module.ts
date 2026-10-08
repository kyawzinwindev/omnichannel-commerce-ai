import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './modules/queue/queue.module';
import { AiModule } from './ai/ai.module';
import { StoreModule } from './store/store.module';
import { TelegramModule } from './telegram/telegram.module';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    DatabaseModule,
    RedisModule,
    QueueModule,
    StoreModule,
    AiModule,
    TelegramModule,
  ],
})
export class AppModule {}
