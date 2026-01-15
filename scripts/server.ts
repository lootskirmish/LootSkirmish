// ============================================================
// SERVER.TS - SERVIDOR LOCAL PARA DESENVOLVIMENTO
// ============================================================
// Simula o comportamento do Vercel localmente
// ============================================================

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Carregar variáveis de ambiente
dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Tipos
interface VercelRequest extends Request {
  rawBody?: Buffer;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: any) => void;
  send: (data: any) => void;
  setHeader: (key: string, value: string) => void;
}

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

// Preserve raw body for webhooks (Stripe/MercadoPago) while still parsing JSON normally.
app.use(express.json({
  verify: (req: VercelRequest, res: Response, buf: Buffer) => {
    req.rawBody = Buffer.from(buf);
  }
}));

app.use(express.urlencoded({
  extended: true,
  verify: (req: VercelRequest, res: Response, buf: Buffer) => {
    req.rawBody = Buffer.from(buf);
  }
}));

// Logs de requisições
app.use((req: Request, res: Response, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================
// ROTAS DA API (SERVERLESS FUNCTIONS)
// ============================================================

// Função auxiliar para importar e executar handlers
async function handleApiRequest(req: VercelRequest, res: Response, handlerPath: string): Promise<void> {
  try {
    const handler = await import(handlerPath);
    
    // Simular o objeto de request/response do Vercel
    const mockVercelReq: VercelRequest = {
      ...req,
      query: req.query,
      body: req.body,
      headers: req.headers,
      method: req.method
    };
    
    const mockVercelRes: VercelResponse = {
      status: (code: number) => {
        res.status(code);
        return mockVercelRes;
      },
      json: (data: any) => {
        res.json(data);
      },
      send: (data: any) => {
        res.send(data);
      },
      setHeader: (key: string, value: string) => {
        res.setHeader(key, value);
      }
    };
    
    await handler.default(mockVercelReq, mockVercelRes);
  } catch (error) {
    const err = error as Error;
    console.error(`Erro na API ${handlerPath}:`, err);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}

// Rotas da API
app.all('/api/_app', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_app.ts');
});

app.all('/api/_admin', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_admin.ts');
});

app.all('/api/_caseopening', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_caseopening.ts');
});

app.all('/api/_chat', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_chat.ts');
});

app.all('/api/_inventory', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_inventory.ts');
});

app.all('/api/_shop', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_shop.ts');
});

// Consolidated APIs
app.all('/api/_profile', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_profile.ts');
});

app.all('/api/_referrals', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_referrals.ts');
});

app.all('/api/_support', async (req: VercelRequest, res: Response) => {
  await handleApiRequest(req, res, '../api/_support.ts');
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req: Request, res: Response) => {
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
process.on('unhandledRejection', (error: any) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error: Error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
