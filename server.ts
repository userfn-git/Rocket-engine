import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MODEL = 'gemini-4-hydrogen';
const ALLOWED_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-argon',
  'gemini-4-carbon',
]);

let cachedUnifiedProfileArm: Record<string, unknown> | null = null;

function resolveModel(requested?: unknown): string {
  if (typeof requested === 'string' && ALLOWED_MODELS.has(requested.trim())) {
    return requested.trim();
  }
  return DEFAULT_MODEL;
}

function getServerGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    res.json({
      status: 'ok',
      runtime: 'LOCALHOST_EXPRESS_ENGINE',
      model: DEFAULT_MODEL,
      geminiConfigured: hasKey,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/gemini/status', (_req, res) => {
    const isConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
    res.json({
      isConfigured,
      source: isConfigured ? 'ENV' : 'LOCAL_OFFLINE_ENGINE',
      model: DEFAULT_MODEL,
    });
  });

  app.post('/api/gemini/stream', async (req, res) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const ai = getServerGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in server environment.',
        code: 'NO_SERVER_KEY',
      });
      return;
    }

    const model = resolveModel(req.body?.model);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents: prompt,
        config: {
          systemInstruction:
            'You are FNPro Master Engine Telemetry Intelligence for Rocket League. Provide concise, accurate analysis of 1000Hz DirectInput curves, deadzones, supersonic velocity (2200-2300 uu/s), and TAInput.ini bindings.',
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text ?? '';
        if (text) {
          res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  });

  app.get('/api/profile/unified', (_req, res) => {
    res.json({
      synced: cachedUnifiedProfileArm !== null,
      profileArm: cachedUnifiedProfileArm,
    });
  });

  app.post('/api/profile/unified', (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Unified profile payload must be a JSON object.' });
      return;
    }
    cachedUnifiedProfileArm = req.body as Record<string, unknown>;
    res.json({
      synced: true,
      updatedAt: new Date().toISOString(),
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(__dirname, 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[FNPro Master Engine] Localhost server active at http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FNPro Master Engine server:', err);
  process.exit(1);
});
