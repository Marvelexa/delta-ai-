import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env': {}
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      exclude: ['playwright', 'playwright-core', 'events']
    },
    server: {
      port: 3001,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3002',
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: 'ws://127.0.0.1:3002',
          ws: true,
        },
      },
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR === 'true' ? false : {
        overlay: false
      },
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/.delta_auto_trader_state.json',
          '**/.paper_trading_state.json',
          '**/*.json',
          '**/*.log',
          '**/scratch/**',
          '**/.system_generated/**',
          '**/tests/**',
          '**/public/**',
          '**/.whatsapp_session/**',
          '**/*.md',
          '**/dist/**'
        ]
      },
    },
  };
});
