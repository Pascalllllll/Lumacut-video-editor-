import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve('src/shared'),
  '@engine': resolve('src/engine'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    // Google sign-in is built in only when the build has an OAuth client (see README.local.md).
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(process.env['LUMACUT_GOOGLE_CLIENT_ID'] ?? ''),
      __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env['LUMACUT_GOOGLE_CLIENT_SECRET'] ?? ''),
    },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'ai-worker': resolve('src/main/ai-worker.ts'),
          'mcp-stdio': resolve('src/main/mcp-stdio.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      externalizeDeps: { exclude: ['zod'] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
  },
})
