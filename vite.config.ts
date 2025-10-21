import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'] // evita múltiplas cópias
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime'] // garante pré-otimização correta
  }
})