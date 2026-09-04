import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'shared': path.resolve(__dirname, '../../shared/src/index.ts'),
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    cors: true,
    // @ts-ignore - allow all preview hosts for Arena
    allowedHosts: true,
    hmr: {
      clientPort: 443,
    },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
  },
});
