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
        // 0.37.1: gold is the ACCENT colour: links, the current top-bar link, small icons, pay, focus rings
        // and the outline or tint of a selected option. It is never a button's fill, and never has text on it.
        // Buttons and selected tabs are green (emerald-*), as they were before Phase 37.
        // Green also means "confirmed / booked / on / success"; amber is "waiting"; rose is "problem".
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
