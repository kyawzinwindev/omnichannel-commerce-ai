'use client';

import React, { useState } from 'react';
import { CloudCog, MessageSquare } from 'lucide-react';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';
import { ChatInput } from './ChatInput';
import { ChatMessage, ProductData, OrderTimelineData } from '../types/chat';

export interface ChatWidgetProps {
  tenantId?: string;
  initialOpen?: boolean;
  onAddToCart?: (product: ProductData) => void;
  apiEndpoint?: string;
}

const defaultInitialMessages: ChatMessage[] = [
  {
    id: 'm1',
    sender: 'assistant',
    text: "Hi! I'm your AI store assistant. Ask me about products, order updates, or general store recommendations.",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  },
];

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  tenantId = 'demo-store-01',
  initialOpen = false,
  onAddToCart,
  apiEndpoint = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001',
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(defaultInitialMessages);
  const [isTyping, setIsTyping] = useState(false);

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    try {
      // Prepare message history for context
      const history = messages.slice(-4).map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      }));

      const res = await fetch(`${apiEndpoint}/api/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          message: text.trim(),
          history,
        }),
      });

      console.log(res)


      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();

      const botProducts: ProductData[] | undefined =
        data.products || data.suggestedProducts
          ? (data.products || data.suggestedProducts).map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: Number(p.price),
            category: p.category,
            inStock: p.inStock !== false,
            image: p.image,
            attributes: p.attributes,
          }))
          : undefined;

      const botOrderTimeline: OrderTimelineData | undefined = data.orderTimeline
        ? {
          orderNumber: data.orderTimeline.orderNumber,
          steps: data.orderTimeline.steps.map((s: any) => ({
            title: s.title,
            timestamp: s.timestamp || s.timestampStr,
            status: s.status,
            icon: s.icon,
          })),
        }
        : undefined;

      const botMsg: ChatMessage = {
        id: `ast-${Date.now()}`,
        sender: 'assistant',
        text: data.reply || 'Here is what I found for you.',
        products: botProducts && botProducts.length > 0 ? botProducts : undefined,
        orderTimeline: botOrderTimeline,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (error: any) {
      console.error('Chat API request error:', error);
      const fallbackMsg: ChatMessage = {
        id: `ast-err-${Date.now()}`,
        sender: 'assistant',
        text: 'Sorry, I had trouble connecting to the store server. Please try again in a moment.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="fixed z-50 bottom-5 right-5 sm:bottom-6 sm:right-6 flex flex-col items-end">
      {/* Chat Window Panel */}
      <section
        id="chat-window"
        role="dialog"
        aria-label="Customer Support Chat"
        aria-hidden={!isOpen}
        className={`widget-panel ${isOpen
            ? 'is-open opacity-100 scale-100 translate-y-0 visible'
            : 'invisible opacity-0 scale-90 translate-y-6 pointer-events-none'
          } fixed inset-0 sm:static sm:inset-auto w-full h-full sm:w-[380px] sm:h-[600px] sm:mb-4 bg-white dark:bg-slateBg-cardDark sm:rounded-[24px] rounded-none shadow-widget flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700/60`}
      >
        {/* Header */}
        <ChatHeader
          title="Store Assistant"
          subtitle="Online & Ready to Help"
          isMinimized={isMinimized}
          onToggleMinimize={() => setIsMinimized((prev) => !prev)}
          onClose={() => setIsOpen(false)}
        />

        {/* Collapsible Body */}
        <div
          id="collapsible"
          className={`collapsible flex-1 min-h-0 ${isMinimized ? 'is-minimized' : ''}`}
        >
          <div className="flex flex-col min-h-0 h-full">
            {/* Messages */}
            <MessageList messages={messages} onAddToCart={onAddToCart} />

            {/* Typing Indicator */}
            {isTyping && <TypingIndicator />}

            {/* Input & Attachments */}
            <ChatInput onSendMessage={handleSendMessage} isLoading={isTyping} />
          </div>
        </div>
      </section>

      {/* Floating Action Button (FAB) */}
      <button
        id="fab"
        type="button"
        aria-label="Open chat"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        className={`fab-btn relative w-14 h-14 rounded-full bg-brand hover:bg-brand-hover text-white shadow-fab flex items-center justify-center active:scale-90 transition focus:outline-none ${isOpen ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100'
          }`}
      >
        <MessageSquare className="w-6 h-6" />
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
          1
        </span>
      </button>
    </div>
  );
};
