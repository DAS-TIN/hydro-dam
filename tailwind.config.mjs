/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#080a10',
          900: '#0c0e18',
          850: '#11141f',
          800: '#171b28',
          750: '#1e2436',
          700: '#283045',
          600: '#384157',
          500: '#516070'
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: '#3a4a7a'
        },
        good: '#4ade80',
        warn: '#fbbf24',
        bad: '#f87171',
        info: '#60a5fa'
      },
      fontFamily: {
        sans: ['Calibri', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
