import { Injectable, Logger } from '@nestjs/common';
import { Conversation, Message, SenderType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RedisChatMessageHistory } from '../redis/redis-chat-history';
import {
  ConversationEventsService,
  ConversationSummary,
  MessageView,
} from './conversation-events.service';

export interface CustomerProfile {
  customerName?: string | null;
  username?: string | null;
}

export interface NewMessage {
  senderType: SenderType;
  content: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: ConversationEventsService,
  ) {}

  /** Creates the tenant/conversation rows if needed and refreshes the customer's profile. */
  async ensureConversation(tenantId: string, chatId: string, profile: CustomerProfile = {}) {
    await this.prisma.tenant.upsert({
      where: { id: tenantId },
      update: {},
      create: { id: tenantId, name: 'Default Store' },
    });

    const profileData = {
      ...(profile.customerName ? { customerName: profile.customerName } : {}),
      ...(profile.username ? { username: profile.username } : {}),
    };

    return this.prisma.conversation.upsert({
      where: { id: chatId },
      update: profileData,
      create: { id: chatId, tenantId, externalUserId: chatId, ...profileData },
    });
  }

  /** Redis is the hot source of truth; falls back to (and re-warms from) the database. */
  async isHumanMode(tenantId: string, chatId: string): Promise<boolean> {
    const session = await this.redis.getSessionState(tenantId, chatId);
    if (typeof session.isHumanMode === 'boolean') return session.isHumanMode;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: chatId },
      select: { isHumanMode: true },
    });
    const isHumanMode = conversation?.isHumanMode ?? false;
    if (isHumanMode) {
      await this.redis.setSessionState(tenantId, chatId, { ...session, isHumanMode });
    }
    return isHumanMode;
  }

  /** Flips AI <-> Human mode in both Redis and the database. */
  async setHumanMode(tenantId: string, chatId: string, isHumanMode: boolean) {
    await this.ensureConversation(tenantId, chatId);

    const conversation = await this.prisma.conversation.update({
      where: { id: chatId },
      data: { isHumanMode },
    });

    const session = await this.redis.getSessionState(tenantId, chatId);
    await this.redis.setSessionState(tenantId, chatId, { ...session, isHumanMode });

    if (!isHumanMode) {
      // Drop the cached LLM history so it is rebuilt from the DB, including what the human said.
      await new RedisChatMessageHistory({
        tenantId,
        conversationId: chatId,
        redisService: this.redis,
      }).clear();
    }

    this.events.publish({ type: 'mode', conversationId: chatId, isHumanMode });
    return this.toSummary(conversation);
  }

  /** Persists messages in order, updates the conversation preview/unread count and notifies the dashboard. */
  async saveMessages(tenantId: string, chatId: string, messages: NewMessage[]) {
    await this.ensureConversation(tenantId, chatId);

    // Stagger timestamps by 1ms so messages saved in one batch keep their order
    // (createdAt has millisecond precision and the thread is sorted by it).
    const baseTime = Date.now();
    const saved: Message[] = [];
    for (const [index, m] of messages.entries()) {
      saved.push(
        await this.prisma.message.create({
          data: {
            conversationId: chatId,
            senderType: m.senderType,
            content: m.content,
            metadata: m.metadata ?? undefined,
            createdAt: new Date(baseTime + index),
          },
        }),
      );
    }

    const last = saved[saved.length - 1];
    const incoming = saved.filter((m) => m.senderType === 'USER').length;
    const conversation = await this.prisma.conversation.update({
      where: { id: chatId },
      data: {
        lastMessageAt: last.createdAt,
        lastMessagePreview: last.content.slice(0, 140),
        ...(incoming > 0 ? { unreadCount: { increment: incoming } } : {}),
      },
    });

    const summary = this.toSummary(conversation);
    for (const m of saved) {
      this.events.publish({ type: 'message', conversation: summary, message: this.toMessageView(m) });
    }
    return saved.map((m) => this.toMessageView(m));
  }

  async list(tenantId: string) {
    const rows = await this.prisma.conversation.findMany({
      where: { tenantId, lastMessageAt: { not: null } },
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    });
    return rows.map((c) => this.toSummary(c));
  }

  async getMessages(chatId: string, limit = 500) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId: chatId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return messages.map((m) => this.toMessageView(m));
  }

  async exists(chatId: string): Promise<boolean> {
    return (await this.prisma.conversation.count({ where: { id: chatId } })) > 0;
  }

  async markRead(chatId: string) {
    await this.prisma.conversation.updateMany({ where: { id: chatId }, data: { unreadCount: 0 } });
  }

  private toSummary(c: Conversation): ConversationSummary {
    return {
      id: c.id,
      customerName: c.customerName,
      username: c.username,
      isHumanMode: c.isHumanMode,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      lastMessagePreview: c.lastMessagePreview,
    };
  }

  private toMessageView(m: Message): MessageView {
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderType: m.senderType,
      content: m.content,
      createdAt: m.createdAt,
    };
  }
}
