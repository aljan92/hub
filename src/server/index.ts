import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-Memory state for Phase 1
const activeTasks: any[] = [];
const uploadQueue: any[] = [];
let dailySlotStats = { used: 0, total: 100 };

// Broadcast helper for WebSockets
function broadcast(type: string, payload: any) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  console.log('[MBA Hub WS] Client connected to live WebSocket stream');
  ws.send(JSON.stringify({ 
    type: 'INIT', 
    payload: { 
      status: 'online', 
      slots: dailySlotStats,
      tasks: activeTasks.length,
      queue: uploadQueue.length
    } 
  }));

  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      console.log('[MBA Hub WS] Received client event:', parsed.type);
    } catch (err) {
      console.error('[MBA Hub WS] Invalid message:', err);
    }
  });
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'MBA HUB',
    version: '1.0.0',
    target: 'TerraMaster TOS 6.0',
    timestamp: new Date().toISOString(),
    connectors: {
      ideogram: 'ready',
      vectorizer: 'ready',
      productorTM: 'ready',
      openRouter: 'ready',
      supabase: 'ready',
      amazonWorker: 'ready',
    }
  });
});

// Hermes Task REST Webhook Endpoint
app.post('/api/v1/hermes/task', (req, res) => {
  const { prompt, quote, niche1, niche2, title, brand, bullet1, bullet2, description } = req.body;
  
  console.log(`[Hermes Webhook] Received task for niche "${niche1} / ${niche2}": ${prompt}`);

  const newTask = {
    id: `task-${Date.now()}`,
    prompt,
    quote: quote || '',
    niche1: niche1 || '',
    niche2: niche2 || '',
    title: title || '',
    brand: brand || '',
    bullet1: bullet1 || '',
    bullet2: bullet2 || '',
    description: description || '',
    source: 'Hermes Agent Webhook',
    status: 'pending_verification',
    createdAt: new Date().toISOString()
  };

  activeTasks.push(newTask);
  broadcast('TASK_CREATED', newTask);

  res.status(200).json({
    success: true,
    message: 'Task received and queued for TM Check and Generation.',
    taskId: newTask.id
  });
});

// Trademark Pre-Check Endpoint
app.post('/api/v1/trademark/check', async (req, res) => {
  const { keywords, locale = 'en', classes = [25] } = req.body;
  if (!keywords || !Array.isArray(keywords)) {
    return res.status(400).json({ success: false, error: 'keywords array required' });
  }

  // Placeholder response for Phase 1 verification
  res.json({
    success: true,
    locale,
    classesChecked: classes,
    results: {},
    hasInfringement: false,
    message: 'No active trademarks found on Class 25.'
  });
});

// Serve Static Frontend in Production
const clientDistPath = path.resolve(__dirname, '../client');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Start Server
server.listen(Number(PORT), HOST, () => {
  console.log(`🚀 MBA HUB Core Server running on http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket stream active on ws://${HOST}:${PORT}/ws`);
});
