'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { ChatWidget } from '../components/ChatWidget';

export default function WidgetDemoPage() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const isDarkMode = document.documentElement.classList.contains('dark');
      setIsDark(isDarkMode);
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (typeof document !== 'undefined') {
      if (nextDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 transition-colors duration-300">
      {/* Background Dot Grid */}
      <div
        className="absolute inset-0 -z-10 opacity-[0.05] dark:opacity-[0.08]"
        style={{
          backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />

      {/* Demo Header */}
      <header className="max-w-3xl mx-auto px-6 pt-14 pb-6">
        <p className="text-xs font-semibold tracking-wider text-brand dark:text-indigo-400 uppercase">
          Universal Chat Widget
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold mt-2 leading-tight">
          Modern Adaptive Support Widget
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400 max-w-lg leading-relaxed">
          This widget is neutral-themed to seamlessly fit any merchant branding in both light and
          dark mode contexts.
        </p>
        <button
          id="theme-toggle"
          type="button"
          suppressHydrationWarning
          onClick={toggleTheme}
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-200/50 dark:hover:bg-slate-800 active:scale-[0.97] transition"
        >
          {mounted && isDark ? (
            <>
              <Sun className="w-4 h-4" />
              <span>Switch to Light Mode</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4" />
              <span>Switch to Dark Mode</span>
            </>
          )}
        </button>
      </header>

      {/* Embedded Modern Chat Widget */}
      <ChatWidget
        tenantId="demo-store-01"
        initialOpen={false}
        onAddToCart={(product) => {
          console.log('Added to cart:', product);
        }}
      />
    </div>
  );
}
