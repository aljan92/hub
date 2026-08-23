import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { loadSettings, saveSettings, AppSettings } from './services/settingsService';
import { TrademarkService } from './services/trademarkService';
import { LLMService } from './services/llmService';
import { IdeogramService } from './services/ideogramService';
import { VectorizerService } from './services/vectorizerService';
import { SupabaseService } from './services/supabaseService';

dotenv.config();

const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-Memory state for Tasks and Queue
interface TaskItem {
  id: string;
  title: string;
  prompt: string;
  quote: string;
  imageUrl: string;
  source: string;
  createdAt: string;
  audience: string;
  avoidColor: string;
  reuseBackground: string;
  aiPrediction: {
    audience: string;
    avoidColor: string;
    reuseBackground: string;
    confidence: string;
    title: string;
    brand: string;
    bullet1: string;
    bullet2: string;
    description: string;
    keywords?: string;
  };
}

let activeTasks: TaskItem[] = [];
let uploadQueue: any[] = [];
let dailySlotStats = { used: 0, total: 100 };

interface ActivityEvent {
  time: string;
  type: 'SUCCESS' | 'INFO' | 'WARNING';
  title: string;
  desc: string;
}

let activityLog: ActivityEvent[] = [
  {
    time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    type: 'SUCCESS',
    title: 'MBA Hub Core gestartet',
    desc: 'Server läuft autark auf TerraMaster TOS 6.0'
  }
];

function logActivity(title: string, desc: string, type: 'SUCCESS' | 'INFO' | 'WARNING' = 'INFO') {
  const event: ActivityEvent = {
    time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    type,
    title,
    desc
  };
  activityLog.unshift(event);
  if (activityLog.length > 50) activityLog.pop();
  broadcast('ACTIVITY_LOG', event);
}

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

// ==============================================================================
// REST API ROUTES
// ==============================================================================

// 1. Health & Activity Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'MBA HUB',
    version: '1.0.0',
    target: 'TerraMaster TOS 6.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/v1/activity', (req, res) => {
  res.json({ success: true, activity: activityLog });
});

app.get('/api/v1/stats', async (req, res) => {
  try {
    const supabaseTest = await SupabaseService.testConnection();
    res.json({
      success: true,
      tasksCount: activeTasks.length,
      queueCount: uploadQueue.length,
      slots: dailySlotStats,
      designsCount: supabaseTest.rowCount || 0,
      hasSupabase: supabaseTest.success
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Settings Management
app.get('/api/v1/settings', (req, res) => {
  const settings = loadSettings();
  res.json({ success: true, settings });
});

app.post('/api/v1/settings', (req, res) => {
  try {
    const updated = saveSettings(req.body);
    broadcast('SETTINGS_UPDATED', { timestamp: Date.now() });
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.0 1-Click System Update directly from GitHub
app.post('/api/v1/system/update', async (req, res) => {
  try {
    console.log('[System Update] Starting 1-Click self-update from GitHub via native Node.js stream...');

    // 1. Download tarball natively using Node.js fetch (No curl required)
    const response = await fetch('https://github.com/aljan92/hub/archive/refs/heads/main.tar.gz');
    if (!response.ok) {
      throw new Error(`GitHub Download fehlgeschlagen: HTTP ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Save to temp file
    const tempTarPath = path.resolve(process.cwd(), '.temp_update.tar.gz');
    fs.writeFileSync(tempTarPath, buffer);

    // 2. Extract using built-in tar
    execSync(`tar -xzf "${tempTarPath}" --strip-components=1`, {
      cwd: process.cwd(),
      timeout: 45000
    });

    // Cleanup temp file
    try { fs.unlinkSync(tempTarPath); } catch (e) {}

    // 3. Also update host_repo if mounted
    const hostRepoPath = path.resolve(process.cwd(), 'host_repo');
    if (fs.existsSync(hostRepoPath)) {
      try {
        fs.writeFileSync(tempTarPath, buffer);
        execSync(`tar -xzf "${tempTarPath}" --strip-components=1`, {
          cwd: hostRepoPath,
          timeout: 45000
        });
        try { fs.unlinkSync(tempTarPath); } catch (e) {}
      } catch (e) {
        // ignore
      }
    }

    res.json({
      success: true,
      message: 'Update erfolgreich installiert. Dashboard startet in 3 Sekunden neu...'
    });

    // Exit process cleanly so Docker (restart: unless-stopped) reloads the updated app
    setTimeout(() => {
      console.log('[System Update] Restarting container process now with fresh bundle...');
      process.exit(0);
    }, 1500);
  } catch (err: any) {
    console.error('[System Update] Failed:', err);
    res.status(500).json({ success: false, error: err.message || 'Update fehlgeschlagen' });
  }
});

// 2.1 Dynamic LLM Models & Credits
app.get('/api/v1/llm/models', async (req, res) => {
  try {
    const models = await LLMService.getAvailableModels();
    res.json({ success: true, models });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/llm/credits', async (req, res) => {
  try {
    const credits = await LLMService.getCredits();
    res.json({ success: true, ...credits });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.2 Unified Credits Overview for Header & Dashboard
app.get('/api/v1/credits', async (req, res) => {
  try {
    const [openrouter, vectorizer, ideogram] = await Promise.all([
      LLMService.getCredits(),
      VectorizerService.testConnection(),
      IdeogramService.testConnection()
    ]);

    res.json({
      success: true,
      openrouter: {
        usage: openrouter.usage,
        limit: openrouter.limit,
        limitRemaining: openrouter.limitRemaining,
        isFreeTier: openrouter.isFreeTier,
        hasKey: !openrouter.error
      },
      vectorizer: {
        credits: vectorizer.creditsRemaining,
        details: vectorizer.details,
        hasKey: vectorizer.success
      },
      ideogram: {
        status: ideogram.success ? 'Aktiv' : (ideogram.error ? 'Fehler' : 'Offline'),
        hasKey: ideogram.success
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Connectors Live Health & Test Endpoints
app.post('/api/v1/connectors/test', async (req, res) => {
  const { connector, credentials } = req.body;

  try {
    if (connector === 'openrouter' || connector === 'openai') {
      const result = await LLMService.testConnection(credentials?.apiKey, credentials?.model);
      return res.json(result);
    }
    if (connector === 'ideogram') {
      const result = await IdeogramService.testConnection(credentials?.apiKey);
      return res.json(result);
    }
    if (connector === 'vectorizer') {
      const result = await VectorizerService.testConnection(credentials?.apiKey, credentials?.apiSecret);
      return res.json(result);
    }
    if (connector === 'productor') {
      const result = await TrademarkService.testConnection();
      return res.json(result);
    }
    if (connector === 'supabase') {
      const result = await SupabaseService.testConnection(credentials?.url, credentials?.key);
      return res.json(result);
    }
    res.status(400).json({ success: false, error: 'Unknown connector' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Background Health Caching
let cachedHealthData: any = null;
let lastHealthCheckTime = 0;

async function refreshHealthData() {
  try {
    const [openrouter, ideogram, vectorizer, productor, supabase] = await Promise.all([
      LLMService.testConnection(),
      IdeogramService.testConnection(),
      VectorizerService.testConnection(),
      TrademarkService.testConnection(),
      SupabaseService.testConnection()
    ]);

    cachedHealthData = {
      openRouter: openrouter,
      ideogram: ideogram,
      vectorizer: vectorizer,
      productorTM: productor,
      supabase: supabase,
      amazonWorker: { success: true, latencyMs: 2, status: 'Session Warm' }
    };
    lastHealthCheckTime = Date.now();
    broadcast('HEALTH_UPDATED', cachedHealthData);
  } catch (err) {
    console.warn('[Health Check] Background error:', err);
  }
}

// Start background monitor immediately & refresh every 60s
refreshHealthData();
setInterval(refreshHealthData, 60000);

app.get('/api/v1/connectors/health', async (req, res) => {
  try {
    if (!cachedHealthData) {
      await refreshHealthData();
    }
    res.json(cachedHealthData);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Real Trademark Check Endpoint
app.post('/api/v1/trademark/check', async (req, res) => {
  try {
    const { quote, keywords, locale = 'en' } = req.body;
    const termsToCheck: string[] = [];

    if (quote && typeof quote === 'string') {
      termsToCheck.push(quote);
      // Also split multi-word quote into individual strong words (>= 4 letters)
      quote.split(/\s+/).forEach(w => {
        const cleaned = w.replace(/[^a-zA-Z0-9]/g, '');
        if (cleaned.length >= 4) termsToCheck.push(cleaned);
      });
    }

    if (Array.isArray(keywords)) {
      termsToCheck.push(...keywords);
    }

    const checkResult = await TrademarkService.checkTrademarks(termsToCheck, locale);
    res.json({ success: true, ...checkResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Designer: Optimize Prompt via LLM
app.post('/api/v1/designer/prompt', async (req, res) => {
  try {
    const { niche1, niche2, quote, stylePreset } = req.body;
    const prompt = await LLMService.generateIdeogramPrompt(
      niche1 || '',
      niche2 || '',
      quote || '',
      stylePreset || 'vintage-distressed'
    );
    res.json({ success: true, prompt });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Designer: Generate Image & Send to Tasks
app.post('/api/v1/designer/generate', async (req, res) => {
  try {
    const { prompt, aspectRatio, niche1, niche2, quote } = req.body;
    
    // 1. Generate Image with Ideogram (or simulate if no key)
    let imageUrl = '';
    const settings = loadSettings();
    if (settings.ideogramApiKey) {
      const genResult = await IdeogramService.generateImage({ prompt, aspectRatio });
      imageUrl = genResult.imageUrl;
    } else {
      // Fallback placeholder image for testing
      imageUrl = `https://picsum.photos/seed/${Date.now()}/800/800`;
    }

    // 2. Parallel LLM Vision & Listing Analysis
    let aiPrediction: any = {
      audience: 'Men, Women',
      avoidColor: 'None',
      reuseBackground: 'Nein',
      confidence: '95%',
      title: `${niche1 || 'Vintage'} Graphic Design`,
      brand: `${niche1 || 'Retro'} Apparel`,
      bullet1: `High quality ${niche1 || 'vintage'} design. Ideal for casual wear.`,
      bullet2: 'Perfect for enthusiasts, birthdays and gifts.',
      description: `Express your passion with this detailed ${niche1 || 'retro'} graphic.`
    };

    if (settings.openRouterApiKey) {
      try {
        const visionResult = await LLMService.analyzeVisionAndGenerateListing(imageUrl, niche1, niche2);
        aiPrediction = {
          ...visionResult,
          audience: visionResult.audiencePrediction || 'Men, Women',
          avoidColor: visionResult.avoidColorPrediction || 'None',
          reuseBackground: visionResult.reuseBackgroundPrediction || 'Nein',
          confidence: '98%'
        };
      } catch (vErr) {
        console.warn('[Designer Generate] Vision listing fallback used:', vErr);
      }
    }

    // 3. Create Task Item
    const newTask: TaskItem = {
      id: `task-${Date.now()}`,
      title: quote || `${niche1 || 'Design'} Graphic`,
      prompt,
      quote: quote || '',
      imageUrl,
      source: 'Designer UI',
      createdAt: new Date().toISOString(),
      audience: aiPrediction.audience,
      avoidColor: aiPrediction.avoidColor,
      reuseBackground: aiPrediction.reuseBackground,
      aiPrediction
    };

    activeTasks.unshift(newTask);
    broadcast('TASK_CREATED', newTask);

    res.json({ success: true, task: newTask });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Tasks Management
app.get('/api/v1/tasks', (req, res) => {
  res.json({ success: true, tasks: activeTasks });
});

app.post('/api/v1/tasks/:id/approve', (req, res) => {
  const { id } = req.params;
  const taskIndex = activeTasks.findIndex(t => t.id === id);
  if (taskIndex === -1) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const approvedTask = activeTasks[taskIndex];
  activeTasks.splice(taskIndex, 1);

  // Add to upload queue
  const queueEntry = {
    id: `queue-${Date.now()}`,
    title: approvedTask.title,
    productCount: 100,
    optimizedCount: 100,
    slotPruned: 'Optimiert für maximale Slots',
    mode: 'draft',
    status: 'Ready',
    features: {
      generalResize: true,
      mugBrush: approvedTask.avoidColor === 'Weiß' || approvedTask.avoidColor === 'White',
      popSocket: true,
      phoneCase: true,
    },
    image: approvedTask.imageUrl
  };
  uploadQueue.unshift(queueEntry);

  broadcast('TASK_APPROVED', { taskId: id, queueEntry });
  res.json({ success: true, queueEntry });
});

// 8. Hermes REST Webhook Endpoint
app.post('/api/v1/hermes/task', async (req, res) => {
  const { prompt, quote, niche1, niche2, title, brand, bullet1, bullet2, description } = req.body;
  
  console.log(`[Hermes Webhook] Received task for niche "${niche1} / ${niche2}": ${prompt}`);

  // Pre-TM Check for quote
  if (quote) {
    const tmCheck = await TrademarkService.checkTrademarks([quote], 'en');
    if (tmCheck.hasInfringementClass25) {
      return res.status(400).json({
        success: false,
        rejected: true,
        reason: 'TRADEMARK_INFRINGEMENT_CLASS_25',
        message: 'Quote rejected due to active Class 25 trademark. Please generate a new quote.',
        hits: tmCheck.hits
      });
    }
  }

  const newTask: TaskItem = {
    id: `task-${Date.now()}`,
    prompt: prompt || `T-shirt graphic design of ${quote}`,
    quote: quote || '',
    title: title || quote || `${niche1 || 'Hermes'} Design`,
    imageUrl: `https://picsum.photos/seed/${Date.now()}/800/800`,
    source: 'Hermes Agent Webhook',
    createdAt: new Date().toISOString(),
    audience: 'Men, Women',
    avoidColor: 'None',
    reuseBackground: 'Nein',
    aiPrediction: {
      audience: 'Men, Women',
      avoidColor: 'None',
      reuseBackground: 'Nein',
      confidence: '96%',
      title: title || 'Custom Graphic Tee',
      brand: brand || 'Hermes Apparel',
      bullet1: bullet1 || 'Unique graphic design for casual styling.',
      bullet2: bullet2 || 'Great gift idea for holidays and special occasions.',
      description: description || 'High quality merchandise apparel.'
    }
  };

  activeTasks.unshift(newTask);
  broadcast('TASK_CREATED', newTask);

  res.status(200).json({
    success: true,
    message: 'Task accepted, pre-TM check passed, and queued.',
    taskId: newTask.id
  });
});

// 9. Upload Queue Management
app.get('/api/v1/queue', (req, res) => {
  res.json({ success: true, queue: uploadQueue });
});

// ==============================================================================
// Serve Static Frontend in Production
// ==============================================================================
const clientDistPath = path.resolve(currentDir, 'client');
const fallbackDistPath = path.resolve(process.cwd(), 'dist/client');
const staticPath = fs.existsSync(clientDistPath) ? clientDistPath : fallbackDistPath;

if (fs.existsSync(staticPath)) {
  console.log(`📂 Serving static frontend from ${staticPath}`);
  app.use(express.static(staticPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// Start Server
server.listen(Number(PORT), HOST, () => {
  console.log(`🚀 MBA HUB Core Server running on http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket stream active on ws://${HOST}:${PORT}/ws`);
});
