import type { Config } from 'tailwindcss'

// Arena Design System theme.
// - ink / ink-soft map to the DS grey text hierarchy (grey/900, grey/600)
// - accent maps to Brand Blue 600 (#1A73E8); accent-deep to Blue 700 hover
// - surface maps to grey/50 page background
// - the built-in `indigo` scale is remapped to the Arena Blue primitives so
//   every existing indigo-* utility across components renders in brand blue.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#2C2D33',
        'ink-soft': '#6D717F',
        accent: '#1A73E8',
        'accent-deep': '#145CBA',
        surface: '#F7F8F9',
        indigo: {
          50: '#F3F8FE',
          100: '#D9E9FC',
          200: '#B3D2F8',
          300: '#8DBBF4',
          400: '#5C9DEF',
          500: '#3B88EC',
          600: '#1A73E8',
          700: '#145CBA',
          800: '#0F468C',
          900: '#0A2E5D',
        },
      },
      fontFamily: {
        display: ['var(--font-sans)', 'Poppins', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'Poppins', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 2px 8px rgba(44, 45, 51, 0.10)',
      },
    },
  },
  plugins: [],
}

export default config
