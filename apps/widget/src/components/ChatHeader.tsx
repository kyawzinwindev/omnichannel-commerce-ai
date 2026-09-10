'use client';

import React from 'react';
import { Bot, ChevronDown, X } from 'lucide-react';

export interface ChatHeaderProps {
  title?: string;
  subtitle?: string;
  isMinimized: boolean;
  onToggleMinimize: () => void;
  onClose: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title = 'Store Assistant',
  subtitle = 'Online & Ready to Help',
  isMinimized,
  onToggleMinimize,
  onClose,
}) => {
  return (
    <header
      id="chat-header"
      onClick={() => {
        if (isMinimized) onToggleMinimize();
      }}
      className="shrink-0 flex items-center gap-3 px-4 py-3.5 bg-brand text-white cursor-pointer select-none"
    >
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full bg-white/20 ring-1 ring-white/30 flex items-center justify-center overflow-hidden">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-brand" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[16px] font-semibold leading-tight truncate">{title}</p>
        <p className="text-[12px] text-white/80 leading-tight mt-0.5">{subtitle}</p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          id="minimize-btn"
          type="button"
          aria-label={isMinimized ? 'Expand chat' : 'Minimize chat'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMinimize();
          }}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/85 hover:bg-white/10 active:scale-90 transition focus:outline-none"
        >
          <ChevronDown
            id="minimize-icon"
            className={`w-[18px] h-[18px] transition-transform duration-300 ${
              isMinimized ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </button>
        <button
          id="close-btn"
          type="button"
          aria-label="Close chat"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/85 hover:bg-white/10 active:scale-90 transition focus:outline-none"
        >
          <X className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  );
};
