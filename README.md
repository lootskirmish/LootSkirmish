# Loot Skirmish

Vite SPA (vanilla JS) + Supabase + API serverless-style em `api/` (compatível com Vercel) e servidor local Express em `server.js`.

## Estrutura do projeto

- `api/`
  - Handlers: `_app.js`, `_admin.js`, `_caseopening.js`, `_chat.js`, `_inventory.js`, `_shop.js`
  - Helpers compartilhados: `_utils.js`
- `app/`
  - `app.js`: entry do frontend
  - `core/`: router + session + store (Redux) + route-loader
  - `features/`: módulos por tela (auth, inventory, caseopening, chat, shop, admin, etc.)
  - `shared/`: constantes/efeitos/temas
- `scripts/server.js`: servidor local (simula Vercel)
- `scripts/START.bat`: atalho Windows (opcional)
- `config/vite.config.js`: dev server + proxy `/api` → `http://localhost:3000`
- `vercel.json`: build + rota `/api/<name>` → `/api/<name>.js`

## Requisitos

- Node.js 18+ recomendado

## Rodar localmente

1) Instalar dependências:

```bash
npm install
```

2) Terminal 1 (API local):

```bash
npm run server
```

3) Terminal 2 (Frontend Vite):

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- Health check: `http://localhost:3000/health`

## Rotas da API (prefixadas com `_`)

Os endpoints públicos são:

- `POST /api/_app`
- `POST /api/_admin`
- `POST /api/_caseopening`
- `POST /api/_chat`
- `POST /api/_inventory`
- `POST /api/_shop`

Observações:
- No dev, o frontend chama `fetch('/api/_shop')` etc, e o Vite proxy encaminha para `http://localhost:3000`.
- Em produção (Vercel), o mapeamento vem do `vercel.json` e cada arquivo em `api/*.js` vira uma Serverless Function.

## Variáveis de ambiente

A API usa Supabase com service key (bypass RLS). Configure em `.env.local` (local) e também nas env vars da Vercel (produção):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `CORS_ORIGINS` (lista separada por vírgula, ex: `http://localhost:5173,http://localhost:3000`)
- `PORT` (opcional; default `3000` no `server.js`)

## Notas de arquitetura (essencial)

- Router: History API + sincronização de tela/URL.
- Redux: store central em `app/core/store.js` com slices para auth/rota/dados.
- Route loader: `app/core/route-loader.js` carrega dados por tela e usa cache para evitar recargas desnecessárias.

## Scripts

- `npm run dev`: Vite dev server
- `npm run server`: API local (Express)
- `npm run build`: build de produção (Vite)
- `npm run preview`: preview do build
