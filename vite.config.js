import { defineConfig, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'

// Treat .js files in src/ as JSX so the component can live in web.js
export default defineConfig({
  plugins: [
    {
      name: 'treat-js-as-jsx',
      async transform(code, id) {
        if (!/src\/.*\.js$/.test(id)) return null
        return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' })
      },
    },
    react(),
  ],
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  server: { port: 5178 }
})
