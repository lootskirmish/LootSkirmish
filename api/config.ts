// ============================================================
// API/CONFIG.TS - Servir configurações de forma segura
// ============================================================

export default async function handler(req: any, res: any): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Apenas POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Parse body if needed
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    // Validar action
    if (body?.action === 'getConfig') {
      return res.status(200).json({
        supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
        supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
      });
    }

    res.status(400).json({ error: 'Invalid request' });
  } catch (err) {
    console.error('[CONFIG] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
