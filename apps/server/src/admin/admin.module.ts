import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule, OrdersModule, TelegramModule],
  controllers: [AdminController],
})
export class AdminModule {}
