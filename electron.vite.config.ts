import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // cross-spawn is bundled into main: electron-builder's dependency scan left its own dependencies
  // (path-key, which…) out of app.asar, and the packaged app failed to start. node-pty stays external (native).
  main: { build: { externalizeDeps: { exclude: ['cross-spawn'] } } },
  preload: {},
  renderer: { plugins: [react()] }
})
