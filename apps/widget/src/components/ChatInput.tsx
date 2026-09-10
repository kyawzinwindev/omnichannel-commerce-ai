'use client';

import React, { useRef, useState } from 'react';
import { Paperclip, Smile, Send, X } from 'lucide-react';

export interface ChatInputProps {
  onSendMessage: (message: string, file?: File | null) => void;
  isLoading?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, isLoading = false }) => {
  const [text, setText] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && !attachedFile) return;
    if (isLoading) return;

    onSendMessage(trimmed, attachedFile);
    setText('');
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiClick = () => {
    if (!textareaRef.current) return;
    const input = textareaRef.current;
    const pos = input.selectionStart || text.length;
    const nextText = text.slice(0, pos) + '🙂' + text.slice(pos);
    setText(nextText);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(pos + 2, pos + 2);
    }, 0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAttachedFile(e.target.files[0]);
    }
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <>
      {/* Attachment Chip */}
      {attachedFile && (
        <div id="attachment-chip" className="px-4 pb-2 bg-slateBg-dim dark:bg-slateBg-dark">
          <div className="inline-flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full pl-3 pr-1.5 py-1.5 shadow-sm">
            <Paperclip className="w-3.5 h-3.5 text-slate-400" />
            <span id="attachment-name" className="text-[12px] max-w-[180px] truncate text-slate-600 dark:text-slate-300">
              {attachedFile.name}
            </span>
            <button
              id="attachment-remove"
              type="button"
              aria-label="Remove attachment"
              onClick={removeAttachment}
              className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              <X className="w-3 h-3 text-slate-500" />
            </button>
          </div>
        </div>
      )}

      {/* Input Container */}
      <footer className="shrink-0 border-t border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slateBg-cardDark px-3 py-3">
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 rounded-full pl-2 pr-1.5 py-1.5 border border-slate-200/60 dark:border-slate-700/50">
          <input
            ref={fileInputRef}
            id="file-input"
            type="file"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            id="attach-btn"
            type="button"
            aria-label="Attach a file"
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700 active:scale-90 transition"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <textarea
            ref={textareaRef}
            id="chat-input"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message…"
            className="flex-1 resize-none bg-transparent text-[14px] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 py-1 max-h-24 overflow-y-auto focus:outline-none"
          />

          <button
            id="emoji-btn"
            type="button"
            aria-label="Insert an emoji"
            onClick={handleEmojiClick}
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700 active:scale-90 transition"
          >
            <Smile className="w-4 h-4" />
          </button>

          <button
            id="send-btn"
            type="button"
            aria-label="Send message"
            onClick={handleSend}
            disabled={(!text.trim() && !attachedFile) || isLoading}
            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center bg-brand text-white disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 hover:enabled:bg-brand-hover active:enabled:scale-90 transition"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-center text-[10.5px] text-slate-400 dark:text-slate-500 mt-2">
          Powered by Smart Support AI
        </p>
      </footer>
    </>
  );
};
