/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Cairo', 'system-ui', 'sans-serif'],
        arabic: ['Cairo', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'Cairo', 'sans-serif'],
      },
      colors: {
        // GoTurtle brand: shell green
        turtle: {
          50: '#effdf5', 100: '#d8f9e6', 200: '#b3f1cf', 300: '#7de4b0', 400: '#41ce8a',
          500: '#19b36e', 600: '#0e9158', 700: '#0d7349', 800: '#0f5b3d', 900: '#0e4b34', 950: '#03291c',
        },
        // Cash / COD accent
        sand: {
          50: '#fffaeb', 100: '#fef0c7', 200: '#fde08a', 300: '#fcc94d', 400: '#fbb324',
          500: '#f5930b', 600: '#d96d06', 700: '#b44b09', 800: '#923a0e', 900: '#78300f',
        },
        ink: {
          50: '#f6f7f9', 100: '#eceef2', 200: '#d5d9e2', 300: '#b0b8c9', 400: '#8592ab', 500: '#667491',
          600: '#515d77', 700: '#424b61', 800: '#394152', 900: '#1f2430', 950: '#13161e',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)',
        pop: '0 12px 32px -8px rgba(16,24,40,.18), 0 4px 8px -4px rgba(16,24,40,.08)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulse2: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.45 } },
      },
      animation: { 'fade-in': 'fade-in .15s ease-out', 'slide-up': 'slide-up .2s ease-out', pulse2: 'pulse2 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
