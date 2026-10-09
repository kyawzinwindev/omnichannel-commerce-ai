import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface ConversationSummary {
  id: string;
  customerName: string | null;
  username: string | null;
  isHumanMode: boolean;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderType: 'USER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';
  content: string;
  createdAt: Date;
}

export type ConversationEvent =
  | { type: 'message'; conversation: ConversationSummary; message: MessageView }
  | { type: 'mode'; conversationId: string; isHumanMode: boolean };

/** In-process pub/sub used to push live conversation updates to the admin dashboard (SSE). */
@Injectable()
export class ConversationEventsService {
  private readonly subject = new Subject<ConversationEvent>();

  get events$(): Observable<ConversationEvent> {
    return this.subject.asObservable();
  }

  publish(event: ConversationEvent): void {
    this.subject.next(event);
  }
}
