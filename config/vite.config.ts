import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  // Configuração importante para rotas do frontend funcionarem
  // Redireciona todas as rotas não encontradas para index.html
  build: {
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  }
});
