'use client';

import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';
import { ChatInput } from './ChatInput';
import { ChatMessage, ProductData } from '../types/chat';

export interface ChatWidgetProps {
  tenantId?: string;
  initialOpen?: boolean;
  onAddToCart?: (product: ProductData) => void;
  customEndpoint?: string;
}

const defaultMessages: ChatMessage[] = [
  {
    id: 'm1',
    sender: 'assistant',
    text: "Hi! I'm your shopping assistant. Ask me about products, order updates, or general store policies.",
    timestamp: '9:41 AM',
  },
  {
    id: 'm2',
    sender: 'user',
    text: 'Do you have the Canvas Weekender Bag in stock?',
    timestamp: '9:42 AM',
  },
  {
    id: 'm3',
    sender: 'assistant',
    text: "It's back in stock! Here are the details:",
    products: [
      {
        id: 'prod-101',
        name: 'Canvas Weekender Bag',
        description: 'Waxed cotton, tan',
        price: 128.0,
        category: 'Bags',
        inStock: true,
      },
    ],
    timestamp: '9:42 AM',
  },
  {
    id: 'm4',
    sender: 'user',
    text: 'Thanks. Any update on order #10492?',
    timestamp: '9:43 AM',
  },
  {
    id: 'm5',
    sender: 'assistant',
    text: 'Here is the latest status for order #10492.',
    orderTimeline: {
      orderNumber: '10492',
      steps: [
        {
          title: 'Order placed',
          timestamp: 'Sep 6, 9:14 AM',
          status: 'completed',
          icon: 'check',
        },
        {
          title: 'In Transit',
          timestamp: 'Sep 8, 11:20 AM',
          status: 'current',
          icon: 'truck',
        },
        {
          title: 'Delivered',
          timestamp: 'Estimated Sep 11',
          status: 'pending',
          icon: 'home',
        },
      ],
    },
    timestamp: '9:43 AM',
  },
];

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  tenantId = 'default-tenant',
  initialOpen = false,
  onAddToCart,
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(defaultMessages);
  const [isTyping, setIsTyping] = useState(false);

  const handleSendMessage = (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);

    // Simulated assistant response with typing delay
    setTimeout(() => {
      setIsTyping(false);
      const botMsg: ChatMessage = {
        id: `ast-${Date.now()}`,
        sender: 'assistant',
        text: 'Thanks for reaching out! A support specialist or automated agent will assist you shortly.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, botMsg]);
    }, 1100);
  };

  return (
    <div className="fixed z-50 bottom-5 right-5 sm:bottom-6 sm:right-6 flex flex-col items-end">
      {/* Chat Window Panel */}
      <section
        id="chat-window"
        role="dialog"
        aria-label="Customer Support Chat"
        aria-hidden={!isOpen}
        className={`widget-panel ${
          isOpen
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
        className={`fab-btn relative w-14 h-14 rounded-full bg-brand hover:bg-brand-hover text-white shadow-fab flex items-center justify-center active:scale-90 transition focus:outline-none ${
          isOpen ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100'
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
