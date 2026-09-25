import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Never allow two copies of React in the bundle ("Invalid hook call" / useRef of null)
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Pre-bundle everything up front so the dev server doesn't re-optimize mid-session
    // (a mid-session re-optimize leaves the browser with mismatched React chunks).
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router-dom',
      'react-big-calendar',
      'date-fns',
      'date-fns/locale',
      'lucide-react',
      'axios',
      'jwt-decode',
      'firebase/app',
      'firebase/auth',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['dev-scheduler.jaccollective.com', 'shiftboard.local', 'dev-scheduler-local.jaccollective.com'],
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
