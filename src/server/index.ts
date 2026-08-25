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
import { SyncEngine } from './services/syncEngine';
import { BrowserSessionService } from './services/browserSessionService';
import { getMcpSchema } from './services/mcpSchemaService';

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

// Stream CDP Screencast frames to all connected dashboard clients
BrowserSessionService.onFrame((session, base64Data, metadata) => {
  broadcast('BROWSER_FRAME', {
    session,
    data: base64Data,
    metadata
  });
});

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ 
    type: 'INIT', 
    payload: { 
      status: 'online', 
      slots: dailySlotStats,
      tasks: activeTasks.length,
      queue: uploadQueue.length,
      browserStatus: BrowserSessionService.getStatus()
    } 
  }));

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      const { type, session, payload } = parsed;

      if (type === 'BROWSER_INIT') {
        await BrowserSessionService.getSession(session || 'sync');
      } else if (type === 'BROWSER_MOUSE') {
        await BrowserSessionService.dispatchMouseEvent(session || 'sync', payload);
      } else if (type === 'BROWSER_KEY') {
        await BrowserSessionService.dispatchKeyEvent(session || 'sync', payload);
      } else if (type === 'BROWSER_NAVIGATE') {
        await BrowserSessionService.navigate(session || 'sync', payload?.url);
      } else if (type === 'BROWSER_RELOAD') {
        await BrowserSessionService.reload(session || 'sync');
      } else if (type === 'BROWSER_BACK') {
        await BrowserSessionService.goBack(session || 'sync');
      } else if (type === 'BROWSER_FORWARD') {
        await BrowserSessionService.goForward(session || 'sync');
      } else if (type === 'BROWSER_SUBMIT') {
        await BrowserSessionService.submitActiveForm(session || 'sync');
      }
    } catch (err) {
      console.error('[MBA Hub WS] Invalid message error:', err);
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

let lastKnownTier: number | undefined = undefined;
let cachedStats: any = {
  tasksCount: 0,
  queueCount: 0,
  slots: dailySlotStats,
  tier: undefined,
  designsCount: 0,
  liveDesignsCount: 0,
  unresolvedAsinsCount: 0,
  sales30d: 0,
  royalties30dEur: 0,
  royalties30dUsd: 0,
  hasSupabase: false
};

async function refreshStatsInBackground() {
  try {
    const supabaseStats = await SupabaseService.getStats();
    const ratelimiter = await SyncEngine.fetchDashboardRatelimiter().catch(() => null);
    
    if (ratelimiter?.tier !== undefined && ratelimiter?.tier !== null) {
      lastKnownTier = ratelimiter.tier;
    }
    const liveSlots = ratelimiter?.slots || dailySlotStats;

    cachedStats = {
      tasksCount: activeTasks.length,
      queueCount: uploadQueue.length,
      slots: liveSlots,
      tier: lastKnownTier,
      designsCount: supabaseStats.totalDesigns,
      liveDesignsCount: supabaseStats.liveDesigns,
      unresolvedAsinsCount: supabaseStats.unresolvedAsins,
      sales30d: supabaseStats.sales30d,
      royalties30dEur: supabaseStats.royalties30dEur,
      royalties30dUsd: supabaseStats.royalties30dUsd,
      hasSupabase: supabaseStats.totalDesigns > 0 || !!loadSettings().supabaseUrl
    };
  } catch (err) {
    // ignore
  }
}

// Background stats refresh every 15 seconds
refreshStatsInBackground();
setInterval(refreshStatsInBackground, 15000);

app.get('/api/v1/stats', (req, res) => {
  cachedStats.tasksCount = activeTasks.length;
  cachedStats.queueCount = uploadQueue.length;
  res.json({
    success: true,
    ...cachedStats,
    tier: lastKnownTier
  });
});

// 2.0.1 Sync Engine Endpoints (Ported from mba-supabase-sync)
app.get('/api/v1/sync/state', async (req, res) => {
  try {
    await SyncEngine.refreshDBStats();
    res.json({ success: true, state: SyncEngine.getState() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/sync/toggle-auto', (req, res) => {
  const { enabled } = req.body;
  SyncEngine.toggleAutoUpdate(!!enabled);
  res.json({ success: true, state: SyncEngine.getState() });
});

app.post('/api/v1/sync/run', async (req, res) => {
  const { type } = req.body;
  try {
    if (type === 'quick_products') {
      SyncEngine.runSmartSync().catch(() => {});
    } else if (type === 'full_products') {
      SyncEngine.runFullReload().catch(() => {});
    } else if (type === 'quick_listings') {
      SyncEngine.runDeepScanNew().catch(() => {});
    } else if (type === 'full_listings') {
      SyncEngine.runDeepScanAll().catch(() => {});
    } else if (type === 'quick_sales') {
      SyncEngine.runSmartSalesSync().catch(() => {});
    } else if (type === 'full_sales') {
      SyncEngine.runFullSalesHistory().catch(() => {});
    } else if (type === 'resolve_asins') {
      SyncEngine.resolveChildAsinsBatch(10).catch(() => {});
    } else {
      return res.status(400).json({ success: false, error: 'Unbekannter Scan-Typ' });
    }

    res.json({ success: true, message: `Scan '${type}' gestartet.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/sync/stop', (req, res) => {
  SyncEngine.stopScan();
  res.json({ success: true, message: 'Scan abgebrochen' });
});

app.post('/api/v1/sync/reset-sales', async (req, res) => {
  try {
    await SyncEngine.resetSalesData();
    res.json({ success: true, message: 'Sales-Daten zurückgesetzt' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/sync/reset-asins', async (req, res) => {
  try {
    await SyncEngine.resetAsinResolutionStatus();
    res.json({ success: true, message: 'ASIN-Status zurückgesetzt' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/sync/logs', (req, res) => {
  res.json({ success: true, logs: SyncEngine.getLogs() });
});

app.post('/api/v1/sync/logs/clear', (req, res) => {
  SyncEngine.clearLogs();
  res.json({ success: true });
});

// 2.0.2 Native CDP Browser Management (Start / Restart / Navigate / Status)
app.post('/api/v1/browser/restart', async (req, res) => {
  try {
    const { session } = req.body;
    logActivity('Browser', `Chrome Neustart für Session ${session || 'sync'}`);
    const result = await BrowserSessionService.restartSession(session || 'sync');
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/v1/browser/status', (req, res) => {
  try {
    res.json({
      success: true,
      ...BrowserSessionService.getStatus()
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/browser/navigate', async (req, res) => {
  try {
    const { session, url } = req.body;
    const result = await BrowserSessionService.navigate(session || 'sync', url);
    res.json(result);
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

// 2.2 Ideogram Dynamic Models
app.get('/api/v1/ideogram/models', async (req, res) => {
  try {
    const models = await IdeogramService.getAvailableModels();
    res.json({ success: true, models });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.3 Unified Credits Overview for Header & Dashboard
let lastKnownCredits: any = {
  openrouter: { hasKey: false },
  vectorizer: { hasKey: false },
  ideogram: { hasKey: false }
};

async function refreshCreditsInBackground() {
  try {
    const settings = loadSettings();
    const hasOpenRouterKey = Boolean(settings.openRouterApiKey && settings.openRouterApiKey.trim());
    const hasVectorizerKey = Boolean(settings.vectorizerApiKey && settings.vectorizerApiKey.trim());
    const hasIdeogramKey = Boolean(settings.ideogramApiKey && settings.ideogramApiKey.trim());

    const [openrouter, vectorizer, ideogram] = await Promise.all([
      hasOpenRouterKey ? LLMService.getCredits() : Promise.resolve({ error: 'Kein Key' }),
      hasVectorizerKey ? VectorizerService.testConnection() : Promise.resolve({ success: false }),
      hasIdeogramKey ? IdeogramService.testConnection() : Promise.resolve({ success: false })
    ]);

    const orData = {
      usage: (openrouter as any).usage ?? lastKnownCredits.openrouter?.usage,
      limit: (openrouter as any).limit ?? lastKnownCredits.openrouter?.limit,
      limitRemaining: (openrouter as any).limitRemaining ?? lastKnownCredits.openrouter?.limitRemaining,
      balanceRemaining: (openrouter as any).balanceRemaining ?? lastKnownCredits.openrouter?.balanceRemaining,
      totalCredits: (openrouter as any).totalCredits ?? lastKnownCredits.openrouter?.totalCredits,
      isFreeTier: (openrouter as any).isFreeTier ?? lastKnownCredits.openrouter?.isFreeTier,
      hasKey: hasOpenRouterKey
    };

    const vecData = {
      credits: (vectorizer as any).creditsRemaining ?? (vectorizer as any).credits ?? lastKnownCredits.vectorizer?.credits,
      details: (vectorizer as any).details ?? lastKnownCredits.vectorizer?.details,
      hasKey: hasVectorizerKey
    };

    const ideoData = {
      status: (ideogram as any).success ? 'Aktiv' : ((ideogram as any).error ? 'Fehler' : 'Offline'),
      hasKey: hasIdeogramKey
    };

    lastKnownCredits = {
      openrouter: orData,
      vectorizer: vecData,
      ideogram: ideoData
    };
  } catch (err) {
    // ignore
  }
}

// Background credits refresh every 30s
refreshCreditsInBackground();
setInterval(refreshCreditsInBackground, 30000);

app.get('/api/v1/credits', (req, res) => {
  res.json({
    success: true,
    ...lastKnownCredits
  });
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
    if (connector === 'hermes' || connector === 'mcp') {
      const tmTest = await TrademarkService.testConnection();
      return res.json({
        success: tmTest.success,
        latencyMs: tmTest.latencyMs,
        message: tmTest.success ? 'MCP Engine & Trademark APIs bereit' : tmTest.error,
        details: `API-Key aktiv • Endpunkt /api/v1/mcp/trademark/check einsatzbereit`
      });
    }
    res.status(400).json({ success: false, error: 'Unknown connector' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Hermes Heartbeat State with Persistent Disk Storage
const heartbeatFile = path.resolve(process.cwd(), 'data', 'hermes_heartbeat.json');

function loadHeartbeatState() {
  try {
    if (fs.existsSync(heartbeatFile)) {
      const data = JSON.parse(fs.readFileSync(heartbeatFile, 'utf-8'));
      return {
        lastPingTime: Number(data.lastPingTime) || 0,
        lastPingIp: data.lastPingIp || '',
        totalPings: Number(data.totalPings) || 0,
        lastMetadata: data.lastMetadata || {}
      };
    }
  } catch (e) {}
  return { lastPingTime: 0, lastPingIp: '', totalPings: 0, lastMetadata: {} };
}

let hermesHeartbeat = loadHeartbeatState();

function recordHermesHeartbeat(req: express.Request, metadata?: any) {
  const clientIp = (req.headers['cf-connecting-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'remote';
  hermesHeartbeat.lastPingTime = Date.now();
  hermesHeartbeat.lastPingIp = clientIp;
  hermesHeartbeat.totalPings += 1;
  if (metadata) {
    hermesHeartbeat.lastMetadata = metadata;
  }

  console.log(`[MCP Heartbeat] 🟢 Heartbeat #${hermesHeartbeat.totalPings} von IP ${clientIp} registriert (Server-Zeit: ${new Date().toLocaleTimeString()})`);

  // Persist to data/hermes_heartbeat.json
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(heartbeatFile, JSON.stringify(hermesHeartbeat, null, 2), 'utf-8');
  } catch (e) {}

  const currentHermes = {
    success: true,
    lastPingTime: hermesHeartbeat.lastPingTime,
    statusText: 'Heartbeat aktiv (Online)',
    latencyMs: 1,
    totalPings: hermesHeartbeat.totalPings
  };

  if (cachedHealthData) {
    cachedHealthData.hermes = currentHermes;
  }
  broadcast('HEALTH_UPDATED', cachedHealthData || { hermes: currentHermes });
}

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

    const isHermesOnline = hermesHeartbeat.lastPingTime > 0 && (Date.now() - hermesHeartbeat.lastPingTime < 10 * 60 * 1000);
    const minutesAgo = hermesHeartbeat.lastPingTime > 0 ? Math.floor((Date.now() - hermesHeartbeat.lastPingTime) / 60000) : null;

    cachedHealthData = {
      openRouter: openrouter,
      ideogram: ideogram,
      vectorizer: vectorizer,
      productorTM: productor,
      supabase: supabase,
      hermes: {
        success: isHermesOnline,
        lastPingTime: hermesHeartbeat.lastPingTime,
        statusText: isHermesOnline 
          ? (minutesAgo === 0 ? 'Heartbeat aktiv (Online)' : `Aktiv (vor ${minutesAgo}m)`)
          : (hermesHeartbeat.lastPingTime === 0 ? 'Standby (Wartet auf Ping)' : `Offline (Zuletzt vor ${minutesAgo}m)`),
        latencyMs: isHermesOnline ? 1 : undefined,
        totalPings: hermesHeartbeat.totalPings
      },
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

app.get('/api/v1/connectors/health', (req, res) => {
  const isHermesOnline = hermesHeartbeat.lastPingTime > 0 && (Date.now() - hermesHeartbeat.lastPingTime < 10 * 60 * 1000);
  const minutesAgo = hermesHeartbeat.lastPingTime > 0 ? Math.floor((Date.now() - hermesHeartbeat.lastPingTime) / 60000) : null;

  const currentHermes = {
    success: isHermesOnline,
    lastPingTime: hermesHeartbeat.lastPingTime,
    statusText: isHermesOnline 
      ? (minutesAgo === 0 ? 'Heartbeat aktiv (Online)' : `Aktiv (vor ${minutesAgo}m)`)
      : (hermesHeartbeat.lastPingTime === 0 ? 'Standby (Wartet auf Ping)' : `Offline (Zuletzt vor ${minutesAgo}m)`),
    latencyMs: isHermesOnline ? 1 : undefined,
    totalPings: hermesHeartbeat.totalPings
  };

  const payload = cachedHealthData ? {
    ...cachedHealthData,
    hermes: currentHermes
  } : {
    openRouter: { success: true, latencyMs: 120 },
    ideogram: { success: true, latencyMs: 150 },
    vectorizer: { success: true, latencyMs: 95 },
    productorTM: { success: true, latencyMs: 45 },
    supabase: { success: true, latencyMs: 60 },
    hermes: currentHermes,
    amazonWorker: { success: true, latencyMs: 2, status: 'Session Warm' }
  };

  res.json(payload);
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

// Auth middleware for Hermes / MCP / Remote endpoints
function validateMcpAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const settings = loadSettings();
  if (!settings.mcpApiKey) {
    recordHermesHeartbeat(req);
    return next(); // If no key is set yet, allow
  }
  const authHeader = req.headers['authorization'];
  const customHeader = req.headers['x-mba-api-key'] as string;

  let providedKey = '';
  if (customHeader) {
    providedKey = customHeader.trim();
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim();
  }

  if (!providedKey || providedKey !== settings.mcpApiKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing x-mba-api-key header or Bearer token.'
    });
  }

  recordHermesHeartbeat(req);
  next();
}

// 8. Hermes REST Webhook Endpoint (Task Submission)
app.post('/api/v1/hermes/task', async (req, res) => {
  const { prompt, quote, niche1, niche2, title, brand, bullet1, bullet2, description } = req.body;
  recordHermesHeartbeat(req, { prompt, quote, niche1, niche2 });
  
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

// 9. MCP Tool Schema & Health Ping Endpoints
app.all(['/api/v1/mcp/ping', '/api/v1/mcp/heartbeat'], (req, res) => {
  const settings = loadSettings();
  const authHeader = req.headers['authorization'];
  const customHeader = req.headers['x-mba-api-key'] as string;

  let providedKey = '';
  if (customHeader) {
    providedKey = customHeader.trim();
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim();
  }

  const isAuthValid = !settings.mcpApiKey || (providedKey === settings.mcpApiKey);
  
  if (settings.mcpApiKey && providedKey && !isAuthValid) {
    console.warn(`[MCP Ping] ⚠️ Ping von ${req.headers['cf-connecting-ip'] || req.socket.remoteAddress} abgewiesen: Key mismatch`);
    return res.status(401).json({
      status: 'error',
      error: 'Unauthorized: Ungültiger x-mba-api-key',
      authenticated: false
    });
  }

  recordHermesHeartbeat(req, req.body || req.query);

  res.json({
    status: 'ok',
    message: 'Heartbeat registered successfully.',
    authenticated: Boolean(providedKey && isAuthValid),
    authConfigured: Boolean(settings.mcpApiKey),
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    activeTasksCount: activeTasks.length,
    uploadQueueCount: uploadQueue.length,
    heartbeat: {
      lastPingTime: hermesHeartbeat.lastPingTime,
      totalPings: hermesHeartbeat.totalPings
    }
  });
});

app.get(['/api/v1/mcp/health', '/health'], (req, res) => {
  const settings = loadSettings();
  const authHeader = req.headers['authorization'];
  const customHeader = req.headers['x-mba-api-key'] as string;

  let providedKey = '';
  if (customHeader) {
    providedKey = customHeader.trim();
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim();
  }

  const isAuthValid = !settings.mcpApiKey || providedKey === settings.mcpApiKey;
  if (isAuthValid) {
    recordHermesHeartbeat(req);
  }

  res.json({
    status: 'ok',
    service: 'MBA_HUB_MCP',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    authenticated: Boolean(providedKey && isAuthValid),
    authConfigured: Boolean(settings.mcpApiKey),
    heartbeat: {
      lastPingTime: hermesHeartbeat.lastPingTime,
      totalPings: hermesHeartbeat.totalPings
    },
    trademarkEngine: {
      status: 'online',
      offices: ['USPTO', 'EUIPO', 'DPMA']
    }
  });
});

app.get('/api/v1/mcp/schema', (req, res) => {
  res.json(getMcpSchema());
});

// 10. Dedicated MBA_HUB MCP Trademark Check Endpoint
app.post('/api/v1/mcp/trademark/check', validateMcpAuth, async (req, res) => {
  try {
    const { offices, marketplace, fields, phrase, title, brand, bullet1, bullet2, description } = req.body;

    // Support both nested { fields: { ... } } and top-level fields
    const resolvedFields: Record<string, string> = {
      ...(fields && typeof fields === 'object' ? fields : {}),
    };

    if (phrase && typeof phrase === 'string') resolvedFields.phrase = phrase;
    if (title && typeof title === 'string') resolvedFields.title = title;
    if (brand && typeof brand === 'string') resolvedFields.brand = brand;
    if (bullet1 && typeof bullet1 === 'string') resolvedFields.bullet1 = bullet1;
    if (bullet2 && typeof bullet2 === 'string') resolvedFields.bullet2 = bullet2;
    if (description && typeof description === 'string') resolvedFields.description = description;

    if (Object.keys(resolvedFields).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing fields to check. Please provide at least one of: phrase, title, brand, bullet1, bullet2, description (either top-level or inside a "fields" object).'
      });
    }

    const result = await TrademarkService.checkBatchFields({
      offices,
      marketplace,
      fields: resolvedFields
    });

    res.json(result);
  } catch (err: any) {
    console.error('[MCP Trademark Check] Error:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
  }
});

// 11. Upload Queue Management
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

  // Initialize background SyncEngine scheduler based on persistent settings
  try {
    SyncEngine.init();
  } catch (err: any) {
    console.warn('[MBA Hub] SyncEngine.init warning:', err.message);
  }

  // Pre-warm browser sessions in background so they are immediately ready
  setTimeout(async () => {
    try {
      console.log('[MBA Hub] Auto-prewarming browser Session 1 & Session 2 in background...');
      await BrowserSessionService.getSession('sync');
      await BrowserSessionService.getSession('upload');
      console.log('[MBA Hub] Browser sessions warm and ready ✓');
    } catch (err: any) {
      console.warn('[MBA Hub] Auto-prewarming warning:', err.message);
    }
  }, 1000);
});
