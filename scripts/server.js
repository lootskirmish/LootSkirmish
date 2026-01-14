// ============================================================
// SERVER.JS - SERVIDOR LOCAL PARA DESENVOLVIMENTO
// ============================================================
// Simula o comportamento do Vercel localmente
// ============================================================

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Carregar variáveis de ambiente
dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

// Preserve raw body for webhooks (Stripe/MercadoPago) while still parsing JSON normally.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = Buffer.from(buf);
  }
}));

app.use(express.urlencoded({
  extended: true,
  verify: (req, res, buf) => {
    req.rawBody = Buffer.from(buf);
  }
}));

// Logs de requisições
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================
// ROTAS DA API (SERVERLESS FUNCTIONS)
// ============================================================

// Função auxiliar para importar e executar handlers
async function handleApiRequest(req, res, handlerPath) {
  try {
    const handler = await import(handlerPath);
    
    // Simular o objeto de request/response do Vercel
    const mockVercelReq = {
      ...req,
      query: req.query,
      body: req.body,
      headers: req.headers,
      method: req.method
    };
    
    const mockVercelRes = {
      status: (code) => {
        res.status(code);
        return mockVercelRes;
      },
      json: (data) => {
        res.json(data);
      },
      send: (data) => {
        res.send(data);
      },
      setHeader: (key, value) => {
        res.setHeader(key, value);
      }
    };
    
    await handler.default(mockVercelReq, mockVercelRes);
  } catch (error) {
    console.error(`Erro na API ${handlerPath}:`, error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Rotas da API
app.all('/api/_app', async (req, res) => {
  await handleApiRequest(req, res, '../api/_app.js');
});

app.all('/api/_admin', async (req, res) => {
  await handleApiRequest(req, res, '../api/_admin.js');
});

app.all('/api/_caseopening', async (req, res) => {
  await handleApiRequest(req, res, '../api/_caseopening.js');
});

app.all('/api/_chat', async (req, res) => {
  await handleApiRequest(req, res, '../api/_chat.js');
});

app.all('/api/_inventory', async (req, res) => {
  await handleApiRequest(req, res, '../api/_inventory.js');
});

app.all('/api/_shop', async (req, res) => {
  await handleApiRequest(req, res, '../api/_shop.js');
});

// Consolidated APIs
app.all('/api/_profile', async (req, res) => {
  await handleApiRequest(req, res, '../api/_profile.js');
});

app.all('/api/_referrals', async (req, res) => {
  await handleApiRequest(req, res, '../api/_referrals.js');
});

app.all('/api/_support', async (req, res) => {
  await handleApiRequest(req, res, '../api/_support.js');
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 LOOT SKIRMISH - Servidor Local');
  console.log('='.repeat(60));
  console.log(`📡 API rodando em: http://localhost:${PORT}`);
  console.log(`🌐 Frontend (Vite): http://localhost:5173`);
  console.log('='.repeat(60));
  console.log('\n📝 Endpoints disponíveis:');
  console.log(`   - http://localhost:${PORT}/api/_app`);
  console.log(`   - http://localhost:${PORT}/api/_admin`);
  console.log(`   - http://localhost:${PORT}/api/_caseopening`);
  console.log(`   - http://localhost:${PORT}/api/_chat`);
  console.log(`   - http://localhost:${PORT}/api/_inventory`);
  console.log(`   - http://localhost:${PORT}/api/_shop`);
  console.log(`   - http://localhost:${PORT}/health`);
  console.log('\n✨ Pronto para receber requisições!\n');
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
