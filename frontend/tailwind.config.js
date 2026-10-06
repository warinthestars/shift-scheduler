/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Phase 37: ShiftUp gold. 500 is the gold in the logo (assets/main_logo_shift-up.png).
        // Use brand-* for buttons, active tabs, links and accents. Green (emerald-*) is only for
        // "confirmed / booked / on / success"; amber is "waiting"; rose is "problem".
        brand: {
          50: '#FFFDEB',
          100: '#FFF9C7',
          200: '#FFF08A',
          300: '#FFE74D',
          400: '#FEDE24',
          500: '#FDD400',
          600: '#D9B500',
          700: '#A88B00',
          800: '#6E5B00',
          900: '#453900',
          950: '#241E00',
        }
      }
    },
  },
  plugins: [],
}
