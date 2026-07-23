import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1b2040',
        'ink-soft': '#4a5072',
        accent: '#5b5bd6',
        'accent-deep': '#4747b8',
        surface: '#f7f7f9',
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 24, 60, 0.05), 0 10px 32px rgba(20, 24, 60, 0.08)',
      },
    },
  },
  plugins: [],
}

export default config
