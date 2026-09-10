'use client';

import React from 'react';

export const TypingIndicator: React.FC = () => {
  return (
    <div id="typing-row" className="px-4 pb-2 -mt-2 bg-slateBg-dim dark:bg-slateBg-dark">
      <div className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 px-3.5 py-2.5 rounded-2xl rounded-bl-md shadow-sm">
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
      </div>
    </div>
  );
};
