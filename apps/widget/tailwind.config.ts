import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        brand: {
          DEFAULT: '#4F46E5',
          hover: '#4338CA',
          light: '#EEF2FF',
          dark: '#3730A3',
          50: '#EEF2FF',
          100: '#E0E7FF',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
        },
        slateBg: {
          light: '#FFFFFF',
          dim: '#F8FAFC',
          dark: '#0F172A',
          cardDark: '#1E293B',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        widget: '0 20px 48px -12px rgba(15, 23, 42, 0.25), 0 4px 12px -4px rgba(15, 23, 42, 0.12)',
        fab: '0 12px 24px -6px rgba(79, 70, 229, 0.4)',
      },
    },
  },
  plugins: [],
};

export default config;
