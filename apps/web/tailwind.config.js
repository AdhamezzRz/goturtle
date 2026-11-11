/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Cairo', 'system-ui', 'sans-serif'],
        arabic: ['Cairo', 'Inter', 'system-ui', 'sans-serif'],
        // Geometric, rounded terminals like the wordmark; covers Latin and Arabic.
        display: ['"Readex Pro"', 'Inter', 'Cairo', 'sans-serif'],
      },
      colors: {
        // GoTurtle brand (go turtle Logo.pdf): deep green #00804C is turtle-600.
        turtle: {
          50: '#ecf8f1', 100: '#d0efdc', 200: '#a3dfbd', 300: '#6bc897', 400: '#33ab71', 500: '#0d9458',
          600: '#00804C', 700: '#006a3f', 800: '#045434', 900: '#06452c', 950: '#02291a',
        },
        // Leaf green #74C465 (leaf-400)
        leaf: {
          50: '#f2f9ef', 100: '#e0f2da', 200: '#c2e5b6', 300: '#9bd48b', 400: '#74C465', 500: '#55a946',
          600: '#418735', 700: '#35692d', 800: '#2d5428', 900: '#264724', 950: '#11260f',
        },
        // Lime #DBE64C (lime-300) — highlights on green / ink, never as text on white.
        lime: {
          50: '#fbfde9', 100: '#f5f9c7', 200: '#ecf292', 300: '#DBE64C', 400: '#c8d42f', 500: '#a8b71e',
          600: '#839015', 700: '#636e16', 800: '#4f5717', 900: '#434a19', 950: '#242903',
        },
        // Cream #F6F8EC — warm brand surface
        cream: { DEFAULT: '#F6F8EC', 50: '#fbfcf6', 100: '#F6F8EC', 200: '#eaeed6', 300: '#d9e0b8' },
        // Cash / COD accent
        sand: {
          50: '#fffaeb', 100: '#fef0c7', 200: '#fde08a', 300: '#fcc94d', 400: '#fbb324',
          500: '#f5930b', 600: '#d96d06', 700: '#b44b09', 800: '#923a0e', 900: '#78300f',
        },
        // Ink: cool navy neutrals ending in the brand ink #080C19
        ink: {
          50: '#f5f6f9', 100: '#eceef3', 200: '#d6dae3', 300: '#b1b8c8', 400: '#8791a8', 500: '#677189',
          600: '#515a71', 700: '#40485d', 800: '#2a3144', 900: '#161c2d', 950: '#080C19',
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
        'arch-draw': { '0%': { strokeDashoffset: 'var(--arch-len)' }, '55%,70%': { strokeDashoffset: '0' }, '100%': { strokeDashoffset: 'calc(var(--arch-len) * -1)' } },
        'arch-in': { from: { strokeDashoffset: 'var(--arch-len)' }, to: { strokeDashoffset: '0' } },
        rise: { from: { opacity: 0, transform: 'translateY(18px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
      },
      animation: {
        'fade-in': 'fade-in .15s ease-out', 'slide-up': 'slide-up .2s ease-out', pulse2: 'pulse2 1.6s ease-in-out infinite',
        'arch-draw': 'arch-draw 1.8s cubic-bezier(.65,0,.35,1) infinite', 'arch-in': 'arch-in 1.1s cubic-bezier(.65,0,.35,1) both',
        rise: 'rise .7s cubic-bezier(.2,.7,.2,1) both', float: 'float 5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
