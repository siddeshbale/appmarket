import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PORT ?? 5174);

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react()],
  // Relative base so the public static export works from any sub-path.
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  preview: { host: '127.0.0.1' },
});
