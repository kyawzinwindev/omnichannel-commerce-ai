import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Connected to PostgreSQL Database via Prisma.');
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.warn(`Initial database connection skipped or failed: ${error.message}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
