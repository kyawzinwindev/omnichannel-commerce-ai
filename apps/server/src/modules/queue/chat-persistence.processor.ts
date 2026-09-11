import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface SaveHistoryJobData {
  tenantId: string;
  conversationId: string;
  userMessage: string;
  aiResponse: string;
  metadata?: Record<string, any>;
}

@Processor('chat-persistence')
export class ChatPersistenceProcessor extends WorkerHost {
  private readonly logger = new Logger(ChatPersistenceProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<SaveHistoryJobData>): Promise<any> {
    const startTime = Date.now();
    const { tenantId, conversationId, userMessage, aiResponse, metadata } = job.data;

    this.logger.log(
      `[Job ${job.id}] Processing save-history for tenant [${tenantId}], conv [${conversationId}] (Attempt: ${job.attemptsMade + 1})`,
    );

    try {
      // 1. Ensure Tenant exists
      await this.prisma.tenant.upsert({
        where: { id: tenantId },
        update: {},
        create: { id: tenantId, name: 'Default Store' },
      });

      // 2. Ensure Conversation exists
      await this.prisma.conversation.upsert({
        where: { id: conversationId },
        update: {},
        create: {
          id: conversationId,
          tenantId,
        },
      });

      // 3. Insert Messages (User & Assistant) into PostgreSQL
      const userMessageLength = userMessage.length;
      const aiResponseLength = aiResponse.length;
      const calculatedTokensEstimate = Math.ceil((userMessageLength + aiResponseLength) / 4);

      const enhancedMetadata = {
        ...(metadata || {}),
        analytics: {
          userMessageLength,
          aiResponseLength,
          estimatedTokens: calculatedTokensEstimate,
          jobProcessedAt: new Date().toISOString(),
          processDurationMs: Date.now() - startTime,
        },
      };

      const messages = await this.prisma.message.createMany({
        data: [
          {
            conversationId,
            senderType: 'USER',
            content: userMessage,
            metadata: { charLength: userMessageLength },
          },
          {
            conversationId,
            senderType: 'ASSISTANT',
            content: aiResponse,
            metadata: enhancedMetadata,
          },
        ],
      });

      const totalDuration = Date.now() - startTime;
      this.logger.log(
        `[Job ${job.id}] Successfully persisted 2 messages for conversation [${conversationId}] in ${totalDuration}ms`,
      );

      return {
        success: true,
        messagesCreated: messages.count,
        conversationId,
        durationMs: totalDuration,
      };
    } catch (error) {
      this.logger.error(
        `[Job ${job.id}] Failed to persist chat history for conversation [${conversationId}]: ${error.message}`,
        error.stack,
      );
      throw error; // Let BullMQ retry according to backoff & attempts configuration
    }
  }
}
