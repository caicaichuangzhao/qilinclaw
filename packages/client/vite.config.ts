import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18168',
        changeOrigin: true,
      },
      '/webhook': {
        target: 'http://127.0.0.1:18168',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:18168',
        ws: true,
      },
    },
  },
});
