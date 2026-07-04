import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: https://all-my-projects-2026.github.io/COIN_FN/ → base 필요
export default defineConfig({
  plugins: [react()],
  base: '/COIN_FN/',
})
