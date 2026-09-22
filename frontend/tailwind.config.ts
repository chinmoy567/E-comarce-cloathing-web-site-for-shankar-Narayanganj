import type { Config } from 'tailwindcss';

/**
 * Design system tokens (spec 01 §Frontend work, `design` skill).
 *
 * These are the ONLY colours available to any later spec. No page or component
 * may introduce a colour outside this set.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    // Mobile-first: 375px is the design baseline, not a max-width.
    screens: {
      sm: '375px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        primary: {
          DEFAULT: '#DC143C',
          hover: '#B01030',
          active: '#A00E2A',
        },
        secondary: '#1F2937',
        accent: '#059669',
        success: '#10B981',
        error: '#DC2626',
        warning: '#F59E0B',
        info: '#0EA5E9',
        background: '#FFFFFF',
        surface: '#F9FAFB',
        text: {
          primary: '#111827',
          secondary: '#6B7280',
          tertiary: '#9CA3AF',
        },
        border: '#E5E7EB',
      },
      // 4px base unit.
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '32px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
