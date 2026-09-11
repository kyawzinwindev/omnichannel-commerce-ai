'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChatMessage, ProductData } from '../types/chat';
import { ProductCard } from './ProductCard';
import { OrderTimeline } from './OrderTimeline';

export interface MessageListProps {
  messages: ChatMessage[];
  onAddToCart?: (product: ProductData) => void;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, onAddToCart }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }

  }, [messages]);

  return (
    <div
      ref={scrollRef}
      id="message-list"
      aria-live="polite"
      className="chat-scroll flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-4 bg-slateBg-dim dark:bg-slateBg-dark"
    >
      {messages.map((msg) => {
        const isUser = msg.sender === 'user';

        if (isUser) {
          return (
            <div key={msg.id} className="msg-item flex flex-col items-end gap-1">
              <div className="max-w-[86%] bg-brand text-white px-4 py-2.5 rounded-2xl rounded-br-md text-[14px] leading-relaxed shadow-sm">
                {msg.text}
              </div>
              {msg.timestamp && (
                <p suppressHydrationWarning className="text-[11px] text-slate-400 dark:text-slate-500 pr-1">
                  {msg.timestamp}
                </p>
              )}
            </div>
          );
        }

        // Assistant message
        return (
          <div key={msg.id} className="msg-item flex flex-col items-start gap-2 max-w-[88%]">
            <div className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/50 px-4 py-2.5 rounded-2xl rounded-bl-md text-[14px] leading-relaxed shadow-sm">
              {msg.text}
            </div>

            {/* Embedded Products */}
            {msg.products && msg.products.length > 0 && (
              <div className="w-full space-y-2.5 pt-1">
                {msg.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAddToCart={onAddToCart}
                  />
                ))}
              </div>
            )}

            {/* Embedded Order Timeline */}
            {msg.orderTimeline && (
              <div className="w-full pt-1">
                <OrderTimeline order={msg.orderTimeline} />
              </div>
            )}

            {msg.timestamp && (
              <p suppressHydrationWarning className="text-[11px] text-slate-400 dark:text-slate-500 pl-1 -mt-1">
                {msg.timestamp}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
