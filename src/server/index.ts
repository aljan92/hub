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
import { subscribeBrowserStream } from './services/browserStreamSubscription';
import { getMcpSchema } from './services/mcpSchemaService';
import { TaskLogService } from './services/taskLogService';
import { TaskRepository } from './storage/taskRepository';
import { SystemPromptService } from './services/systemPromptService';
import { ProductCatalogService } from './services/productCatalogService';
import { ProductScannerService } from './services/productScannerService';
import { QueueService } from './services/queueService';
import { UploadWorkerService } from './services/uploadWorkerService';
import { CostTrackingService } from './services/costTrackingService';
import { AmazonInspectService } from './services/amazonInspectService';
import { UpdatePipelineService } from './services/updatePipelineService';
import { DesignPipelineService } from './services/designPipelineService';
import { TrademarkWhitelistService } from './services/trademarkWhitelistService';
import { UpdateBackfillService } from './services/updateBackfillService';
import { VisionOptimizationService } from './services/visionOptimizationService';
import { TaskRecoveryService } from './services/taskRecoveryService';
import { AmazonRecoveryVerificationService } from './services/amazonRecoveryVerificationService';

dotenv.config();

const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

// Readiness Gate state (Phase P3.1): Blocks mutating requests during crash recovery
let isSystemReady = false;
export function getSystemReady(): boolean {
  return isSystemReady;
}

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const browserWatchSessions = new WeakMap<WebSocket, 'sync' | 'upload'>();
const browserFrameSequences: Record<'sync' | 'upload', number> = { sync: 0, upload: 0 };
const MAX_BROWSER_FRAME_BUFFER_BYTES = 512 * 1024;

// Broadcast helper for WebSockets
function broadcast(type: string, payload: any) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Connect broadcaster to TaskLogService
TaskLogService.setBroadcaster(broadcast);

// Connect broadcaster to UploadWorkerService
UploadWorkerService.onStatusUpdate((status) => {
  broadcast('UPLOAD_STATUS_UPDATE', status);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Readiness Gate (Phase P3.1): Blocks mutating requests during crash recovery & reconciliation
app.use((req, res, next) => {
  if (isSystemReady) return next();
  // Allow health checks, status checks, and static assets
  if (req.method === 'GET' || req.path === '/api/health' || !req.path.startsWith('/api/v1/')) {
    return next();
  }
  return res.status(503).json({
    success: false,
    error: 'SYSTEM_RECOVERY_IN_PROGRESS',
    message: 'MBA Hub führt gerade die Crash-Recovery und Speicher-Reconciliation durch. Bitte in Kürze wiederholen.'
  });
});

// In-Memory state for Queue and Stats
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

// Stream only the newest useful CDP frame to clients watching this session.
// Slow clients are skipped instead of accumulating an ever-growing delayed video queue.
BrowserSessionService.onFrame((session, base64Data, metadata) => {
  const watchingClients = Array.from(wss.clients).filter(client =>
    client.readyState === WebSocket.OPEN && browserWatchSessions.get(client) === session
  );
  if (watchingClients.length === 0) return;

  const sequence = ++browserFrameSequences[session];
  const message = JSON.stringify({
    type: 'BROWSER_FRAME',
    payload: { session, data: base64Data, metadata, sequence, sentAt: Date.now() }
  });
  for (const client of watchingClients) {
    if (client.bufferedAmount <= MAX_BROWSER_FRAME_BUFFER_BYTES) {
      client.send(message);
    }
  }
});

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ 
    type: 'INIT', 
    payload: { 
      status: 'online', 
      slots: dailySlotStats,
      tasks: TaskLogService.getAwaitingTasks().length,
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
      } else if (type === 'BROWSER_WATCH') {
        // Register BEFORE replaying the cached frame. Static pages may never emit
        // another CDP frame, so subscribing alone can leave the viewer blank forever.
        await subscribeBrowserStream(browserWatchSessions, ws, session, type => BrowserSessionService.getSession(type));
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

    // Synchronize QueueService and dailySlotStats with live slots from Amazon
    if (liveSlots) {
      dailySlotStats = liveSlots;
      QueueService.setDailySlots(liveSlots.free, liveSlots.used, liveSlots.total);
    }

    const liveDesignsCount = (ratelimiter?.liveDesignsCount !== undefined && ratelimiter.liveDesignsCount !== null)
      ? ratelimiter.liveDesignsCount
      : (supabaseStats.liveDesigns > 0 ? supabaseStats.liveDesigns : cachedStats.liveDesignsCount);

    cachedStats = {
      tasksCount: TaskLogService.getAwaitingTasks().length,
      queueCount: QueueService.getActiveQueueCount(),
      slots: liveSlots,
      tier: lastKnownTier,
      designsCount: supabaseStats.totalDesigns,
      liveDesignsCount,
      freeDesignsCount: ratelimiter?.freeDesignsCount,
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

app.get('/api/v1/stats', async (req, res) => {
  cachedStats.tasksCount = TaskLogService.getAwaitingTasks().length;
  cachedStats.queueCount = QueueService.getActiveQueueCount();
  const costStats = await CostTrackingService.getCostStats().catch(() => null);
  res.json({
    success: true,
    ...cachedStats,
    tier: lastKnownTier,
    costs: costStats ? {
      totalCosts: costStats.totalCosts,
      costPerDesign: costStats.costPerDesign,
      openRouterCost: costStats.openRouterCost,
      imagesCost: costStats.imagesCost,
      vectorizationsCost: costStats.vectorizationsCost,
      activeDesignsCount: costStats.activeDesignsCount,
      waitingDesignsCount: costStats.waitingDesignsCount,
      completedDesignsCount: costStats.completedDesignsCount
    } : undefined
  });
});

// Cost Statistics Endpoints
app.get('/api/v1/stats/costs', async (req, res) => {
  try {
    const costStats = await CostTrackingService.getCostStats();
    res.json({ success: true, ...costStats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/stats/costs/reset', async (req, res) => {
  try {
    const costStats = await CostTrackingService.resetCostStats();
    res.json({ success: true, message: 'Kostenstatistik erfolgreich zurückgesetzt', ...costStats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
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

    // 2. Extract using built-in tar (Safeguarding data/ directory from ever being touched)
    execSync(`tar -xzf "${tempTarPath}" --strip-components=1 --exclude="data" --exclude="data/*"`, {
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
        execSync(`tar -xzf "${tempTarPath}" --strip-components=1 --exclude="data" --exclude="data/*"`, {
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
      message: 'Update erfolgreich installiert. Dashboard startet in 10 Sekunden neu...'
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

    const circuit = LLMService.isCircuitBroken();
    const threshold = settings.openRouterMinBalanceThreshold ?? 1.00;
    const balance = (openrouter as any).balanceRemaining ?? lastKnownCredits.openrouter?.balanceRemaining;
    const isLowBalance = balance !== undefined && balance !== null && balance < threshold;

    const orData = {
      usage: (openrouter as any).usage ?? lastKnownCredits.openrouter?.usage,
      limit: (openrouter as any).limit ?? lastKnownCredits.openrouter?.limit,
      limitRemaining: (openrouter as any).limitRemaining ?? lastKnownCredits.openrouter?.limitRemaining,
      balanceRemaining: balance,
      totalCredits: (openrouter as any).totalCredits ?? lastKnownCredits.openrouter?.totalCredits,
      isFreeTier: (openrouter as any).isFreeTier ?? lastKnownCredits.openrouter?.isFreeTier,
      hasKey: hasOpenRouterKey,
      isCircuitBroken: circuit.broken,
      circuitBreakReason: circuit.reason,
      minBalanceThreshold: threshold,
      isLowBalance
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

app.get('/api/v1/credits', async (req, res) => {
  if (req.query.forceFresh === 'true') {
    await refreshCreditsInBackground();
  }
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

// Amazon Merch API Inspector Endpoint (Debug & Inspection in Session 1)
app.post('/api/v1/debug/amazon-inspect', async (req, res) => {
  const { designId, endpoint } = req.body;
  try {
    if (endpoint === 'productconfig') {
      const result = await AmazonInspectService.inspectProductConfig(designId);
      return res.json(result);
    }
    if (endpoint === 'findlistings') {
      const result = await AmazonInspectService.inspectFindListings(designId);
      return res.json(result);
    }
    return res.status(400).json({
      success: false,
      error: 'Ungültiger Endpunkt. Erlaubt: "productconfig" oder "findlistings".'
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Interner Serverfehler beim Amazon API Inspector'
    });
  }
});

// Amazon Merch Standalone DOM Live Products Inspector
app.post('/api/v1/debug/amazon-inspect-dom', async (req, res) => {
  const { designId } = req.body;
  try {
    if (!designId) {
      return res.status(400).json({
        success: false,
        error: 'Keine Design-ID (UUID) angegeben.'
      });
    }

    const result = await AmazonInspectService.inspectDomProducts(designId);
    return res.json(result);
  } catch (err: any) {
    console.error('[AmazonInspectService] Fehler bei inspectDomProducts:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Fehler beim Auslesen des DOM-Produkt-Popups'
    });
  }
});

// Amazon Merch Create Update Task Endpoint (#xxx-U from Session 1)
app.post('/api/v1/debug/amazon-create-update-task', async (req, res) => {
  const { designId } = req.body;
  try {
    if (!designId) {
      return res.status(400).json({
        success: false,
        error: 'Keine Design-ID (UUID) angegeben.'
      });
    }

    const taskLog = await AmazonInspectService.createUpdateTaskFromAmazon(designId);
    return res.json({
      success: true,
      task: taskLog,
      message: `Update-Task ${taskLog.id} erfolgreich erstellt!`
    });
  } catch (err: any) {
    console.error('[AmazonInspectService] Fehler bei createUpdateTaskFromAmazon:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Fehler beim Erstellen des Update-Tasks aus Amazon-Daten'
    });
  }
});

// Amazon Merch Download Artwork Endpoint (isolated tab in Session 1)
app.post('/api/v1/debug/amazon-download-artwork', async (req, res) => {
  const { taskId, designId } = req.body;
  try {
    if (!taskId || !designId) {
      return res.status(400).json({
        success: false,
        error: 'Task-ID und Design-ID sind erforderlich.'
      });
    }

    const result = await AmazonInspectService.downloadDesignArtwork(taskId, designId);
    if (!result.success) {
      return res.status(500).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    console.error('[AmazonInspectService] Fehler bei downloadDesignArtwork:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Fehler beim Downloaden des Designs aus Amazon Merch'
    });
  }
});

// Update Pipeline Single Step Execution (U1 to U7)
app.post('/api/v1/update-pipeline/step', async (req, res) => {
  const { taskId, step, designId } = req.body;
  try {
    if (step === 'U1') {
      if (!designId) return res.status(400).json({ success: false, error: 'Design ID erforderlich für U1' });
      const result = await UpdatePipelineService.stepU1_ExtractMerchData(designId);
      return res.json(result);
    }
    if (!taskId) return res.status(400).json({ success: false, error: 'Task ID erforderlich' });
    const result = await UpdatePipelineService.runStep(taskId, step);
    return res.json(result);
  } catch (err: any) {
    console.error(`[UpdatePipeline] Fehler bei Step ${step}:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update Pipeline Full Sequential Run
app.post('/api/v1/update-pipeline/run', async (req, res) => {
  const { designId } = req.body;
  try {
    if (!designId) return res.status(400).json({ success: false, error: 'Design ID erforderlich' });
    const result = await UpdatePipelineService.runUpdatePipeline(designId);
    return res.json(result);
  } catch (err: any) {
    console.error('[UpdatePipeline] Fehler bei runUpdatePipeline:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Design Pipeline Single Step Execution (D1 to D8)
app.post('/api/v1/design-pipeline/step', async (req, res) => {
  const { taskId, step } = req.body;
  try {
    if (!taskId) return res.status(400).json({ success: false, error: 'Task ID erforderlich' });
    const result = await DesignPipelineService.runStep(taskId, step);
    return res.json(result);
  } catch (err: any) {
    console.error(`[DesignPipeline] Fehler bei Step ${step}:`, err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Design Pipeline Full Sequential Run
app.post('/api/v1/design-pipeline/run', async (req, res) => {
  const { taskId } = req.body;
  try {
    if (!taskId) return res.status(400).json({ success: false, error: 'Task ID erforderlich' });
    const result = await DesignPipelineService.runDesignPipeline(taskId);
    return res.json(result);
  } catch (err: any) {
    console.error('[DesignPipeline] Fehler bei runDesignPipeline:', err);
    return res.status(500).json({ success: false, error: err.message });
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

// 4.1 Trademark Whitelist Management Endpoints
app.get('/api/v1/trademark/whitelist', (req, res) => {
  try {
    const whitelist = TrademarkWhitelistService.getWhitelist();
    res.json({ success: true, whitelist });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/trademark/whitelist', (req, res) => {
  try {
    const { office = 'GLOBAL', term } = req.body;
    if (!term) return res.status(400).json({ success: false, error: 'Term required' });
    const whitelist = TrademarkWhitelistService.addTerm(office, term);
    res.json({ success: true, whitelist });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/trademark/whitelist/batch', (req, res) => {
  try {
    const { office = 'GLOBAL', terms = [] } = req.body;
    const whitelist = TrademarkWhitelistService.addTermsBatch(office, terms);
    res.json({ success: true, whitelist });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/v1/trademark/whitelist', (req, res) => {
  try {
    const { office = 'GLOBAL', term } = req.body;
    if (!term) return res.status(400).json({ success: false, error: 'Term required' });
    const whitelist = TrademarkWhitelistService.removeTerm(office, term);
    res.json({ success: true, whitelist });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.2 Trademark Batch Check Endpoint (Sandbox)
app.post('/api/v1/trademark/batch-check', async (req, res) => {
  try {
    const { offices, fields } = req.body;
    const result = await TrademarkService.checkBatchFields({ offices, fields });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.3 Update Backfill In-Flight Reset Endpoint
app.post('/api/v1/update/backfill/reset', (req, res) => {
  try {
    const result = UpdateBackfillService.resetInFlightLocks();
    res.json(result);
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
    const clientIp = (req.headers['cf-connecting-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'local';

    const taskLog = TaskLogService.createTaskLog({
      source: 'DESIGNER',
      payload: {
        prompt,
        aspectRatio,
        niche1,
        niche2,
        quote
      },
      clientIp
    });

    broadcast('TASK_LOG_CREATED', taskLog);
    res.json({ success: true, taskId: taskLog.id, task: taskLog });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Tasks Management (Connected to Human-in-the-Loop Engine)
app.get('/api/v1/tasks', (req, res) => {
  if (TaskLogService.isStorageFailSafe()) {
    return res.status(500).json({
      success: false,
      corrupted: true,
      error: 'TASK_STORAGE_CORRUPTED: Task-Speicher ist beschädigt. Schreibvorgänge sind im Fail-Safe-Modus gesperrt.',
      tasks: []
    });
  }
  const awaiting = TaskLogService.getAwaitingTaskSummaries();
  res.json({ success: true, tasks: awaiting });
});

// 7.1 Task Logs Management Endpoints for Prompt Log UI (Must be declared BEFORE /:taskId)
app.get('/api/v1/tasks/log', (req, res) => {
  if (TaskLogService.isStorageFailSafe()) {
    return res.status(500).json({
      success: false,
      corrupted: true,
      error: 'TASK_STORAGE_CORRUPTED: Task-Speicher ist beschädigt. Schreibvorgänge sind im Fail-Safe-Modus gesperrt.',
      tasks: []
    });
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
  const source = req.query.source as any;
  const status = req.query.status as any;
  const checkpoint = req.query.checkpoint as any;
  const search = req.query.search ? String(req.query.search) : undefined;

  const result = TaskLogService.getTaskSummariesPage({
    limit,
    cursor,
    source,
    status,
    checkpoint,
    search
  });

  res.json(result);
});

app.delete('/api/v1/tasks/log', (req, res) => {
  TaskLogService.clearTaskLogs();
  broadcast('TASK_LOGS_CLEARED', {});
  res.json({ success: true, message: 'All task logs cleared' });
});

app.get('/api/v1/tasks/:taskId', (req, res) => {
  const task = TaskLogService.getTaskLogById(req.params.taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: `Task ${req.params.taskId} nicht gefunden` });
  }
  res.json({ success: true, task });
});

app.post('/api/v1/tasks/:taskId/submit-design-review', async (req, res) => {
  const { taskId } = req.params;
  const { action, answers, updatedPrompt } = req.body;
  try {
    const result = await TaskLogService.submitDesignReview(taskId, { action, answers, updatedPrompt });
    broadcast('TASK_UPDATED', TaskLogService.getTaskSummaryById(taskId));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/tasks/:taskId/submit-tm-review', async (req, res) => {
  const { taskId } = req.params;
  const { action, refinedListing } = req.body;
  try {
    const result = await TaskLogService.submitTmReview(taskId, { action, refinedListing });
    broadcast('TASK_UPDATED', TaskLogService.getTaskSummaryById(taskId));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/tasks/:taskId/override-preflight', async (req, res) => {
  const { taskId } = req.params;
  const { action, newQuote } = req.body;
  try {
    const result = await TaskLogService.overridePreFlight(taskId, { action, newQuote });
    broadcast('TASK_UPDATED', TaskLogService.getTaskSummaryById(taskId));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/tasks/:taskId/submit-svg-review', async (req, res) => {
  const { taskId } = req.params;
  const { action, editedSvgContent, maxColors } = req.body;
  try {
    const result = await TaskLogService.submitSvgReview(taskId, { action, editedSvgContent, maxColors });
    broadcast('TASK_UPDATED', TaskLogService.getTaskSummaryById(taskId));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/v1/tasks/:taskId/reset-svg', async (req, res) => {
  const { taskId } = req.params;
  try {
    const result = await TaskLogService.resetSvg(taskId);
    broadcast('TASK_UPDATED', TaskLogService.getTaskSummaryById(taskId));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Phase P3.3: Human Review Actions for AWAITING_RECOVERY_REVIEW
app.post('/api/v1/tasks/:taskId/submit-recovery-review', async (req, res) => {
  const { taskId } = req.params;
  const { action, amazonDesignId, reason } = req.body;

  try {
    let result: any = { success: false };
    if (action === 'REVERIFY_REMOTE') {
      result = await AmazonRecoveryVerificationService.reverifyRemote(taskId);
    } else if (action === 'MARK_CONFIRMED') {
      if (!amazonDesignId) throw new Error('amazonDesignId ist erforderlich für MARK_CONFIRMED');
      result = AmazonRecoveryVerificationService.markConfirmed(taskId, amazonDesignId);
    } else if (action === 'FORCE_RETRY') {
      result = AmazonRecoveryVerificationService.forceRetry(taskId, reason || 'Manuell erzwungener Retry');
    } else if (action === 'CANCEL') {
      result = AmazonRecoveryVerificationService.cancelUpload(taskId, reason || 'Vom Benutzer abgebrochen');
    } else {
      throw new Error(`Unbekannte Recovery Action: ${action}`);
    }

    broadcast('TASK_UPDATED', TaskLogService.getTaskSummaryById(taskId));
    broadcast('QUEUE_UPDATED', QueueService.loadQueue());
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/v1/tasks/:taskId/recovery-candidates', async (req, res) => {
  const { taskId } = req.params;
  try {
    const result = await AmazonRecoveryVerificationService.findPossibleAmazonCandidates(taskId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, candidates: [] });
  }
});

// Auth middleware for Hermes / MCP / Remote endpoints
function validateMcpAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Allow internal requests from Dashboard / Playground / Designer
  const isInternal = req.query.source === 'test' || 
                     req.query.source === 'designer' || 
                     req.headers['x-internal-source'] === 'hub-ui' ||
                     req.headers['sec-fetch-site'] === 'same-origin';
  if (isInternal) {
    return next();
  }

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

// 8.0 Dedicated Design Ingestion Endpoint (/design & /api/v1/design)
app.post(['/api/v1/design', '/design', '/api/v1/hermes/design', '/api/v1/mcp/design'], validateMcpAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const rawSource = (req.query.source as string) || (req.headers['x-task-source'] as string) || payload.source || 'HERMES';
    let source: 'HERMES' | 'TEST' | 'DESIGNER' = 'HERMES';
    const up = String(rawSource).toUpperCase();
    if (up === 'TEST' || up === 'T') source = 'TEST';
    else if (up === 'DESIGNER' || up === 'D') source = 'DESIGNER';

    const clientIp = (req.headers['cf-connecting-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'remote';

    // Create persistent task log
    const taskLog = TaskLogService.createTaskLog({
      source,
      payload,
      clientIp
    });

    if (source === 'HERMES') {
      recordHermesHeartbeat(req, {
        taskId: taskLog.id,
        niche1: payload.niche1,
        quote: payload.quote
      });
    }

    broadcast('TASK_LOG_CREATED', TaskLogService.toTaskSummary(taskLog));

    res.json({
      success: true,
      taskId: taskLog.id,
      source: taskLog.source,
      receivedAt: taskLog.receivedAt,
      payload: taskLog.payload
    });
  } catch (err: any) {
    console.error('[Design Ingestion] Error processing task:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
  }
});

// Full Workspace Reset: Deletes all tasks, queue items, and all design/artwork files on disk
app.post('/api/v1/system/purge-all-data', (req, res) => {
  try {
    const result = TaskLogService.purgeAllWorkspaceData();
    broadcast('TASK_LOGS_CLEARED', {});
    broadcast('TASKS_UPDATED', { tasks: [] });
    broadcast('QUEUE_UPDATED', { items: [] });
    res.json({
      success: true,
      message: `System erfolgreich zurückgesetzt: ${result.deletedTasks} Tasks, ${result.deletedQueueItems} Queue-Einträge und ${result.deletedFiles} Design-Dateien gelöscht.`,
      ...result
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Fehler beim System-Reset' });
  }
});

app.delete('/api/v1/system/purge-all-data', (req, res) => {
  try {
    const result = TaskLogService.purgeAllWorkspaceData();
    broadcast('TASK_LOGS_CLEARED', {});
    broadcast('TASKS_UPDATED', { tasks: [] });
    broadcast('QUEUE_UPDATED', { items: [] });
    res.json({
      success: true,
      message: `System erfolgreich zurückgesetzt: ${result.deletedTasks} Tasks, ${result.deletedQueueItems} Queue-Einträge und ${result.deletedFiles} Design-Dateien gelöscht.`,
      ...result
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Fehler beim System-Reset' });
  }
});

app.delete('/api/v1/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const deleted = TaskLogService.deleteTaskLog(taskId);
  if (deleted) {
    return res.json({ success: true, message: `Task ${taskId} gelöscht.` });
  }
  return res.status(404).json({ success: false, error: `Task ${taskId} nicht gefunden.` });
});

app.post('/api/v1/tasks/:taskId/retry', async (req, res) => {
  const { taskId } = req.params;
  const { stepType, eventIndex } = req.body;
  try {
    const result = await TaskLogService.retryFromStep(taskId, stepType, eventIndex);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8.1 System Prompts Settings
app.get('/api/v1/systemprompts', (req, res) => {
  const prompts = SystemPromptService.getAllPrompts();
  res.json({
    success: true,
    ...prompts
  });
});

app.post('/api/v1/systemprompts', (req, res) => {
  SystemPromptService.savePrompts(req.body);
  const updated = SystemPromptService.getAllPrompts();
  res.json({
    success: true,
    ...updated
  });
});

app.post('/api/v1/systemprompts/reset', (req, res) => {
  const { type } = req.body;
  const resetPrompts = SystemPromptService.resetToDefault(type || 'all');
  res.json({
    success: true,
    ...resetPrompts
  });
});

// 8.3 Design Image Serving Endpoint (Prioritizes transparent cutout master PNG _mba.png)
app.get('/api/v1/designs/image/:taskId', (req, res) => {
  const cleanId = req.params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const mbaFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
  const rawFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (fs.existsSync(mbaFilePath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(mbaFilePath).pipe(res);
  }

  if (fs.existsSync(rawFilePath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(rawFilePath).pipe(res);
  }

  const task = TaskLogService.getTaskLogById(req.params.taskId);
  if (task?.localImagePath && fs.existsSync(task.localImagePath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(task.localImagePath).pipe(res);
  }
  if (task && task.imageUrl) {
    return res.redirect(task.imageUrl);
  }

  const queueItems = QueueService.loadQueue();
  const qItem = queueItems.find(q => q.id === req.params.taskId || q.taskId === req.params.taskId || q.designId === req.params.taskId);
  if (qItem?.pngPath && fs.existsSync(qItem.pngPath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(qItem.pngPath).pipe(res);
  }
  if (qItem?.imagePath && fs.existsSync(qItem.imagePath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(qItem.imagePath).pipe(res);
  }

  res.status(404).send('Design image not found');
});

// 8.3b Design 2x2 Grid Image Serving Endpoint (with automatic on-demand generation)
app.get('/api/v1/designs/grid2x2/:taskId', async (req, res) => {
  const cleanId = req.params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const gridFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_grid2x2.jpg`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (fs.existsSync(gridFilePath)) {
    try {
      const stats = fs.statSync(gridFilePath);
      if (stats.size > 1000) {
        res.setHeader('Content-Type', 'image/jpeg');
        return fs.createReadStream(gridFilePath).pipe(res);
      }
    } catch (e) {}
  }

  // Look for source master PNG to generate 2x2 grid on demand
  const mbaFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
  const rawFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
  const task = TaskLogService.getTaskLogById(req.params.taskId);
  const targetPath = (task?.localMbaPngPath && fs.existsSync(task.localMbaPngPath))
    ? task.localMbaPngPath
    : (task?.localImagePath && fs.existsSync(task.localImagePath))
    ? task.localImagePath
    : fs.existsSync(mbaFilePath) ? mbaFilePath : fs.existsSync(rawFilePath) ? rawFilePath : null;

  if (targetPath) {
    try {
      console.log(`[API] Erzeuge 2x2 Grid für Task ${cleanId} on-demand aus ${targetPath}...`);
      const { savedPath } = await VisionOptimizationService.prepareVisionImage(targetPath, gridFilePath);
      if (savedPath && fs.existsSync(savedPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        return fs.createReadStream(savedPath).pipe(res);
      }
    } catch (e: any) {
      console.warn(`[API] Grid-Generierung on-demand fehlgeschlagen für ${cleanId}:`, e.message);
    }
  }

  // Fallback to regular design image if master PNG not found
  res.redirect(`/api/v1/designs/image/${encodeURIComponent(req.params.taskId)}`);
});

// 8.3c Design U4 Preview Image Serving Endpoint (1125x1350 on #B8B8B8 with automatic on-demand generation)
app.get('/api/v1/designs/u4-preview/:taskId', async (req, res) => {
  const cleanId = req.params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const previewFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.u4-preview.png`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (fs.existsSync(previewFilePath)) {
    try {
      const stats = fs.statSync(previewFilePath);
      if (stats.size > 1000) {
        res.setHeader('Content-Type', 'image/png');
        return fs.createReadStream(previewFilePath).pipe(res);
      }
    } catch (e) {}
  }

  // Look for source master PNG to generate U4 preview on demand
  const mbaFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
  const rawFilePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.png`);
  const task = TaskLogService.getTaskLogById(req.params.taskId);
  const targetPath = (task?.localMbaPngPath && fs.existsSync(task.localMbaPngPath))
    ? task.localMbaPngPath
    : (task?.localImagePath && fs.existsSync(task.localImagePath))
    ? task.localImagePath
    : fs.existsSync(mbaFilePath) ? mbaFilePath : fs.existsSync(rawFilePath) ? rawFilePath : null;

  if (targetPath) {
    try {
      console.log(`[API] Erzeuge U4 Preview für Task ${cleanId} on-demand aus ${targetPath}...`);
      const { savedPath } = await VisionOptimizationService.prepareU4PreviewImage(targetPath, previewFilePath);
      if (savedPath && fs.existsSync(savedPath)) {
        res.setHeader('Content-Type', 'image/png');
        return fs.createReadStream(savedPath).pipe(res);
      }
    } catch (e: any) {
      console.warn(`[API] U4-Preview Generierung on-demand fehlgeschlagen für ${cleanId}:`, e.message);
    }
  }

  // Fallback to regular design image if master PNG not found
  res.redirect(`/api/v1/designs/image/${encodeURIComponent(req.params.taskId)}`);
});

// 8.4 Design SVG Serving Endpoints
app.get('/api/v1/designs/svg/:taskId', (req, res) => {
  const cleanId = req.params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.svg`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return fs.createReadStream(filePath).pipe(res);
  }
  const task = TaskLogService.getTaskLogById(req.params.taskId);
  if (task && task.svgContent) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(task.svgContent);
  }
  res.status(404).send('Design SVG not found');
});

app.get('/api/v1/designs/svg-original/:taskId', (req, res) => {
  const cleanId = req.params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_original.svg`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return fs.createReadStream(filePath).pipe(res);
  }
  // Fallback to active svg if original not separate yet
  const fallbackPath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}.svg`);
  if (fs.existsSync(fallbackPath)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return fs.createReadStream(fallbackPath).pipe(res);
  }
  const task = TaskLogService.getTaskLogById(req.params.taskId);
  if (task && task.svgContent) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(task.svgContent);
  }
  res.status(404).send('Original SVG not found');
});

// 8.5 MBA Print-PNG (4500x5400) Serving Endpoint
app.get('/api/v1/designs/mba-png/:taskId', (req, res) => {
  const cleanId = req.params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_mba.png`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(filePath).pipe(res);
  }
  res.status(404).send('MBA PNG not found');
});

// 8.6 4-Panel Multifarben Verification Image Serving Endpoint
app.get('/api/v1/designs/4panel/:taskId', (req, res) => {
  const cleanId = req.params.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.resolve(process.cwd(), 'data', 'designs', `${cleanId}_4panel.png`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/png');
    return fs.createReadStream(filePath).pipe(res);
  }
  res.status(404).send('4-Panel image not found');
});

// 8.2 Hermes REST Webhook Endpoint (Task Submission)
app.post('/api/v1/hermes/task', async (req, res) => {
  const payload = req.body || {};
  const clientIp = (req.headers['cf-connecting-ip'] as string) || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'remote';
  recordHermesHeartbeat(req, { niche1: payload.niche1, niche2: payload.niche2, quote: payload.quote });
  
  const taskLog = TaskLogService.createTaskLog({
    source: 'HERMES',
    payload,
    clientIp
  });

  broadcast('TASK_LOG_CREATED', taskLog);

  res.status(200).json({
    success: true,
    message: 'Task accepted and queued.',
    taskId: taskLog.id
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
    activeTasksCount: TaskLogService.getAwaitingTasks().length,
    uploadQueueCount: QueueService.getActiveQueueCount(),
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
app.post(['/api/v1/mcp/trademark/check', '/api/v1/trademark/check', '/api/v1/mcp/trademark', '/api/v1/trademark', '/trademark'], validateMcpAuth, async (req, res) => {
  try {
    const { offices, marketplace, fields, phrase, quote, text, terms, title, brand, bullet1, bullet2, description } = req.body || {};

    // Support both nested { fields: { ... } } and top-level fields
    const resolvedFields: Record<string, string> = {
      ...(fields && typeof fields === 'object' ? fields : {}),
    };

    if (quote && typeof quote === 'string') resolvedFields.quote = quote;
    if (phrase && typeof phrase === 'string') resolvedFields.phrase = phrase;
    if (text && typeof text === 'string') resolvedFields.text = text;
    if (title && typeof title === 'string') resolvedFields.title = title;
    if (brand && typeof brand === 'string') resolvedFields.brand = brand;
    if (bullet1 && typeof bullet1 === 'string') resolvedFields.bullet1 = bullet1;
    if (bullet2 && typeof bullet2 === 'string') resolvedFields.bullet2 = bullet2;
    if (description && typeof description === 'string') resolvedFields.description = description;

    if (Array.isArray(terms) && terms.length > 0) {
      terms.forEach((t, i) => {
        if (typeof t === 'string' && t.trim()) {
          resolvedFields[`term_${i + 1}`] = t.trim();
        }
      });
    }

    if (Object.keys(resolvedFields).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing fields to check. Please provide at least one of: quote, phrase, text, title, brand, bullet1, bullet2, description, terms (array), or inside a "fields" object.'
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

// 11. Intelligent Upload Queue & Slot Balancing API
app.get('/api/v1/queue', (req, res) => {
  try {
    const state = QueueService.getState();
    res.json({ success: true, ...state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rebalance Queue
app.post('/api/v1/queue/rebalance', (req, res) => {
  try {
    const freeSlots = req.body.freeSlots !== undefined ? Number(req.body.freeSlots) : undefined;
    const state = QueueService.rebalanceQueue(freeSlots);
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reorder Queue Items (Drag and Drop)
app.post('/api/v1/queue/reorder', (req, res) => {
  try {
    const { itemIds } = req.body;
    if (!Array.isArray(itemIds)) {
      return res.status(400).json({ success: false, error: 'itemIds array is required' });
    }
    const state = QueueService.reorderItems(itemIds);
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Queue Settings (Schedule Time, Max Drop, Auto Balance, Upload Mode, Draft Products, Update Target, Auto Backfill, Max Active Products)
app.patch('/api/v1/queue/settings', (req, res) => {
  try {
    const { 
      uploadScheduleTime, 
      maxDropPerDesign, 
      autoBalance, 
      uploadMode, 
      draftProductsPerDesign,
      queueUpdateTargetCount,
      updateTargetCount,
      queueUpdateAutoBackfillEnabled,
      updateAutoBackfillEnabled,
      queueUpdateMaxActiveProducts,
      updateMaxActiveProducts
    } = req.body;
    
    const current = loadSettings();
    const updated = {
      ...current,
      queueUploadScheduleTime: uploadScheduleTime !== undefined ? uploadScheduleTime : current.queueUploadScheduleTime,
      queueMaxDropPerDesign: maxDropPerDesign !== undefined ? Number(maxDropPerDesign) : current.queueMaxDropPerDesign,
      queueAutoBalance: autoBalance !== undefined ? Boolean(autoBalance) : current.queueAutoBalance,
      queueUploadMode: uploadMode !== undefined ? uploadMode : current.queueUploadMode,
      queueDraftProductsPerDesign: draftProductsPerDesign !== undefined ? Number(draftProductsPerDesign) : current.queueDraftProductsPerDesign,
      queueUpdateTargetCount: (queueUpdateTargetCount !== undefined ? queueUpdateTargetCount : updateTargetCount) !== undefined 
        ? Number(queueUpdateTargetCount !== undefined ? queueUpdateTargetCount : updateTargetCount) 
        : current.queueUpdateTargetCount,
      queueUpdateAutoBackfillEnabled: (queueUpdateAutoBackfillEnabled !== undefined ? queueUpdateAutoBackfillEnabled : updateAutoBackfillEnabled) !== undefined 
        ? Boolean(queueUpdateAutoBackfillEnabled !== undefined ? queueUpdateAutoBackfillEnabled : updateAutoBackfillEnabled) 
        : current.queueUpdateAutoBackfillEnabled,
      queueUpdateMaxActiveProducts: (queueUpdateMaxActiveProducts !== undefined ? queueUpdateMaxActiveProducts : updateMaxActiveProducts) !== undefined 
        ? Number(queueUpdateMaxActiveProducts !== undefined ? queueUpdateMaxActiveProducts : updateMaxActiveProducts) 
        : current.queueUpdateMaxActiveProducts
    };
    saveSettings(updated);
    const state = QueueService.rebalanceQueue();
    
    if (updated.queueUpdateAutoBackfillEnabled) {
      const { UpdateBackfillService } = require('./services/updateBackfillService');
      UpdateBackfillService.runBackfillCycle(false).catch((err: any) => {
        console.error('[UpdateBackfillService] Fehler beim sofortigen Backfill-Trigger:', err.message);
      });
    }

    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger 1x manual pull of candidate design from Supabase
app.post('/api/v1/queue/update-backfill/run-once', async (req, res) => {
  try {
    const { UpdateBackfillService } = require('./services/updateBackfillService');
    const result = await UpdateBackfillService.runBackfillCycle(true);
    const state = QueueService.getState();
    res.json({ ...result, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== UPLOAD WORKER API ====================

// Start Automated Upload
app.post('/api/v1/upload/start', async (req, res) => {
  try {
    const { queueId, mode, pauseBeforePublish } = req.body;
    const result = await UploadWorkerService.startUpload(queueId, mode || 'draft', Boolean(pauseBeforePublish));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Resume and Publish upload paused in inspection mode
app.post('/api/v1/upload/resume-publish', (req, res) => {
  try {
    const result = UploadWorkerService.resumeAndPublish();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cancel Running Upload
app.post('/api/v1/upload/cancel', async (req, res) => {
  try {
    const result = await UploadWorkerService.cancelUpload();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Live Upload Status
app.get('/api/v1/upload/status', (req, res) => {
  try {
    const status = UploadWorkerService.getStatus();
    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle Hero-Lock on a queue item
app.post('/api/v1/queue/item/:id/lock', (req, res) => {
  try {
    const item = QueueService.toggleLock(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Queue item not found' });
    }
    const state = QueueService.getState();
    res.json({ success: true, item, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle Pause on a queue item
app.post('/api/v1/queue/item/:id/pause', (req, res) => {
  try {
    const item = QueueService.togglePause(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Queue item not found' });
    }
    const state = QueueService.getState();
    res.json({ success: true, item, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Retry / Re-enqueue item into WAITING
app.post('/api/v1/queue/item/:id/retry', (req, res) => {
  try {
    const item = QueueService.retryItem(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Queue item not found' });
    }
    const state = QueueService.getState();
    res.json({ success: true, item, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Re-push / Enqueue Task into Upload Queue
app.post(['/api/v1/tasks/:id/enqueue', '/api/v1/tasks/enqueue'], (req, res) => {
  try {
    const rawId = req.params.id || req.body?.taskId || req.query?.taskId;
    if (!rawId) {
      return res.status(400).json({ success: false, error: 'Keine Task-ID übergeben' });
    }
    const taskId = decodeURIComponent(String(rawId));
    const task = TaskLogService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, error: `Task #${taskId} nicht gefunden` });
    }

    if (!task.localMbaPngPath && !task.mbaPngUrl) {
      return res.status(400).json({ success: false, error: `Task #${taskId} besitzt noch kein fertig generiertes Master-PNG.` });
    }

    TaskLogService.completeTaskAndEnqueue(task);
    const queueState = QueueService.getState();
    res.json({ success: true, message: `Task #${taskId} erfolgreich in die Upload-Queue übertragen!`, task, queueState });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete item from queue
app.delete('/api/v1/queue/item/:id', (req, res) => {
  try {
    const removed = QueueService.removeItem(req.params.id);
    const state = QueueService.getState();
    res.json({ success: true, removed, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear completed or all items
app.delete('/api/v1/queue', (req, res) => {
  try {
    const onlyCompleted = req.query.onlyCompleted === 'true';
    QueueService.clearQueue(onlyCompleted);
    const state = QueueService.getState();
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Force Refresh Daily Slots from Amazon Merch in Session 1
app.post('/api/v1/queue/refresh-slots', async (req, res) => {
  try {
    const ratelimiter = await SyncEngine.fetchDashboardRatelimiter(undefined, true);
    if (ratelimiter?.slots) {
      dailySlotStats = ratelimiter.slots;
      QueueService.setDailySlots(ratelimiter.slots.free, ratelimiter.slots.used, ratelimiter.slots.total);
    }
    const queueState = QueueService.getState();
    const stats = { ...cachedStats, slots: ratelimiter?.slots || dailySlotStats };
    res.json({ success: true, slots: ratelimiter?.slots || dailySlotStats, queueState, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Droppable Products Configuration
app.patch('/api/v1/products/drop-config', (req, res) => {
  try {
    const configs = req.body.configs || [];
    ProductCatalogService.updateDropConfig(configs);
    // Trigger queue rebalance with new drop configurations
    const queueState = QueueService.rebalanceQueue();
    const stats = ProductCatalogService.getStats();
    const maxDroppableCapacity = ProductCatalogService.calculateMaxDroppableSlotsCount();
    res.json({
      success: true,
      stats,
      maxDroppableCapacity,
      queueState
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Avoid Rule for a single product color
app.post('/api/v1/products/color-avoid-rule', (req, res) => {
  try {
    const { productId, colorId, avoidRule } = req.body;
    if (!productId || !colorId) {
      return res.status(400).json({ success: false, error: 'productId und colorId erforderlich' });
    }
    const validRule = avoidRule === 'white' ? 'white' : (avoidRule === 'black' ? 'black' : 'none');
    const catalog = ProductCatalogService.updateProductColorAvoidRule(productId, colorId, validRule);
    res.json({
      success: true,
      catalog,
      message: `Farbregel für ${colorId} auf ${validRule} gesetzt.`
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Nice Class for a product
app.post('/api/v1/products/nice-class', (req, res) => {
  try {
    const { productId, niceClass } = req.body;
    if (!productId || typeof niceClass !== 'number' || isNaN(niceClass)) {
      return res.status(400).json({ success: false, error: 'productId und niceClass (number) erforderlich' });
    }
    const catalog = ProductCatalogService.updateProductNiceClass(productId, niceClass);
    res.json({
      success: true,
      catalog,
      message: `Nizza-Klasse für ${productId} auf Kl. ${niceClass} aktualisiert.`
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update artwork configuration for a product
app.post('/api/v1/products/artwork-config', (req, res) => {
  try {
    const { productId, artwork } = req.body;
    if (!productId || !artwork || typeof artwork !== 'object') {
      return res.status(400).json({ success: false, error: 'productId und artwork erforderlich' });
    }
    const catalog = ProductCatalogService.updateProductArtworkConfig(productId, artwork);
    res.json({
      success: true,
      catalog,
      message: `Artwork-Konfiguration für ${productId} erfolgreich aktualisiert.`
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get central artwork variant registry
app.get('/api/v1/products/artwork-variants', (req, res) => {
  res.json({
    success: true,
    variants: Object.values(ProductCatalogService.getArtworkVariantRegistry())
  });
});

// ==============================================================================
// 12. Product Database & CDP Scanner API
// ==============================================================================

// Get current product catalog and slot statistics
app.get('/api/v1/products/catalog', (req, res) => {
  try {
    const catalog = ProductCatalogService.getCatalog();
    const stats = ProductCatalogService.getStats();
    const scannerState = ProductScannerService.getState();
    res.json({
      success: true,
      catalog,
      stats,
      scannerState
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Fehler beim Laden des Katalogs' });
  }
});

// Get scanner status and audit logs
app.get('/api/v1/products/scan/status', (req, res) => {
  try {
    const state = ProductScannerService.getState();
    res.json({
      success: true,
      state
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger manual product scan
app.post('/api/v1/products/scan', async (req, res) => {
  try {
    // Run scan asynchronously to not block HTTP response
    ProductScannerService.startScan().catch(err => {
      console.error('[API /products/scan] Background error:', err);
    });

    res.json({
      success: true,
      message: 'Produkt-Scan wurde in Session 1 gestartet.'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete product database and immediately trigger fresh rescan
app.delete('/api/v1/products/catalog', async (req, res) => {
  try {
    const result = await ProductScannerService.clearAndRescan();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
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

// Phase P3.1 Startup Sequence:
// 1. Initialize SQLite Task Storage
TaskRepository.init();

// 2. Ensure Queue is loaded into memory
QueueService.ensureLoaded();

// 3. Execute Crash Recovery & Cross-Storage Reconciliation BEFORE any mutating background service
try {
  TaskRecoveryService.initAndReconcile();
} catch (err: any) {
  console.error('[MBA Hub] 🚨 Critical failure during TaskRecoveryService.initAndReconcile:', err);
}

// 4. Unblock mutating API calls through the Readiness Gate
isSystemReady = true;

// Start Server
server.listen(Number(PORT), HOST, () => {
  console.log(`🚀 MBA HUB Core Server running on http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket stream active on ws://${HOST}:${PORT}/ws`);

  // 5. Initialize background schedulers only AFTER recovery is complete
  try {
    SyncEngine.init();
  } catch (err: any) {
    console.warn('[MBA Hub] SyncEngine.init warning:', err.message);
  }

  try {
    ProductScannerService.init();
  } catch (err: any) {
    console.warn('[MBA Hub] ProductScannerService.init warning:', err.message);
  }

  try {
    const { UpdateBackfillService } = require('./services/updateBackfillService');
    UpdateBackfillService.startScheduler();
  } catch (err: any) {
    console.warn('[MBA Hub] UpdateBackfillService.startScheduler warning:', err.message);
  }

  // 6. Launch Phase P3.2 background recovery queue worker
  try {
    TaskRecoveryService.startRecoveryQueueWorker(1);
  } catch (err: any) {
    console.warn('[MBA Hub] TaskRecoveryService.startRecoveryQueueWorker warning:', err.message);
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

// Graceful Shutdown Hooks
const handleGracefulShutdown = (signal: string) => {
  console.log(`[MBA Hub] Received ${signal}. Starting graceful shutdown...`);
  try {
    TaskRepository.close();
  } catch (e: any) {
    console.warn('[MBA Hub] Error during TaskRepository close:', e.message);
  }
  server.close(() => {
    console.log('[MBA Hub] HTTP & WebSocket server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000);
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
