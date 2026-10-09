import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConversationsService } from '../conversations.service';

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

  constructor(private readonly conversations: ConversationsService) {
    super();
  }

  async process(job: Job<SaveHistoryJobData>): Promise<any> {
    const startTime = Date.now();
    const { tenantId, conversationId, userMessage, aiResponse, metadata } = job.data;

    this.logger.log(
      `[Job ${job.id}] Processing save-history for tenant [${tenantId}], conv [${conversationId}] (Attempt: ${job.attemptsMade + 1})`,
    );

    try {
      const userMessageLength = userMessage.length;
      const aiResponseLength = aiResponse.length;

      const saved = await this.conversations.saveMessages(tenantId, conversationId, [
        { senderType: 'USER', content: userMessage, metadata: { charLength: userMessageLength } },
        {
          senderType: 'ASSISTANT',
          content: aiResponse,
          metadata: {
            ...(metadata || {}),
            analytics: {
              userMessageLength,
              aiResponseLength,
              estimatedTokens: Math.ceil((userMessageLength + aiResponseLength) / 4),
              jobProcessedAt: new Date().toISOString(),
              processDurationMs: Date.now() - startTime,
            },
          },
        },
      ]);

      const totalDuration = Date.now() - startTime;
      this.logger.log(
        `[Job ${job.id}] Persisted ${saved.length} messages for conversation [${conversationId}] in ${totalDuration}ms`,
      );
      return { success: true, messagesCreated: saved.length, conversationId, durationMs: totalDuration };
    } catch (error) {
      this.logger.error(
        `[Job ${job.id}] Failed to persist chat history for conversation [${conversationId}]: ${error.message}`,
        error.stack,
      );
      throw error; // Let BullMQ retry according to backoff & attempts configuration
    }
  }
}
