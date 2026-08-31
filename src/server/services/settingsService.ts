import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import crypto from 'crypto';

export interface AppSettings {
  openRouterApiKey: string;
  llmProvider: 'openrouter' | 'openai';
  llmModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
  llmTimeoutSeconds: number;
  ideogramApiKey: string;
  ideogramModel: string;
  ideogramRenderingSpeed: string;
  ideogramAspectRatio: string;
  ideogramStyle: string;
  ideogramMagicPromptOption: string;
  vectorizerApiKey: string;
  vectorizerApiSecret: string;
  vectorizerModePreview: 'test' | 'production';
  vectorizerModeProduction: 'test' | 'production';
  vectorizerMaxColors: number;
  vectorizerAutoColorCountOffset: number;
  vectorizerShapeStacking: 'cutouts' | 'stacked';
  vectorizerGroupBy: 'color' | 'none';
  vectorizerMinArea: number;
  vectorizerDrawStyle: 'fill_shapes' | 'stroke_shapes' | 'stroke_edges';
  vectorizerOptimizedShapes: boolean;
  vectorizerGapFiller: boolean;
  vectorizerLineFitTolerance: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  productorUsptoAuth: string;
  productorEuipoAuth: string;
  productorDpmaAuth: string;
  nasHost: string;
  nasUser: string;
  autoSlotFillHour: number;
  autoSyncEnabled: boolean;
  mcpApiKey: string;
  aiAutonomyEnabled: boolean;
  queueUploadScheduleTime: string; // e.g. "04:00" or "off"
  queueMaxDropPerDesign: number;   // e.g. 10
  queueAutoBalance: boolean;       // e.g. true
  queueUploadMode: 'draft' | 'live' | 'hybrid'; // e.g. 'draft', 'live', or 'hybrid'
  queueDraftProductsPerDesign: number; // e.g. 106
  queueUpdateTargetCount: number;      // e.g. 10
  queueUpdateAutoBackfillEnabled: boolean; // e.g. false (defaults to OFF)
  queueUpdateMaxActiveProducts: number;    // e.g. 100 (skip designs with >= 100 live products)
  costPerImage: number;            // e.g. 0.08 ($ / image)
  costPerVectorization: number;    // e.g. 0.05 ($ / vectorization)
  costStatsResetTimestamp?: string;// e.g. ISO string for stats reset
  costStatsBaselineOpenRouterUsage?: number; // e.g. OpenRouter baseline usage at reset
}

export function generateApiKey(): string {
  return `mba_${crypto.randomBytes(20).toString('hex')}`;
}

const DEFAULT_SETTINGS: AppSettings = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  llmProvider: (process.env.LLM_PROVIDER as 'openrouter' | 'openai') || 'openrouter',
  llmModel: process.env.LLM_MODEL || 'anthropic/claude-3-5-sonnet',
  llmTemperature: 0.35,
  llmMaxTokens: 3000,
  llmTimeoutSeconds: 90,
  ideogramApiKey: process.env.IDEOGRAM_API_KEY || '',
  ideogramModel: process.env.IDEOGRAM_MODEL || 'V_3',
  ideogramRenderingSpeed: 'DEFAULT',
  ideogramAspectRatio: '10x16',
  ideogramStyle: 'GENERAL',
  ideogramMagicPromptOption: 'AUTO',
  vectorizerApiKey: process.env.VECTORIZER_API_KEY || '',
  vectorizerApiSecret: process.env.VECTORIZER_API_SECRET || '',
  vectorizerModePreview: 'test',
  vectorizerModeProduction: 'production',
  vectorizerMaxColors: 2,
  vectorizerAutoColorCountOffset: 0,
  vectorizerShapeStacking: 'cutouts',
  vectorizerGroupBy: 'none',
  vectorizerMinArea: 10,
  vectorizerDrawStyle: 'fill_shapes',
  vectorizerOptimizedShapes: true,
  vectorizerGapFiller: false,
  vectorizerLineFitTolerance: 0.1,
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  productorUsptoAuth: process.env.PRODUCTOR_USPTO_AUTH || 'Basic cHJvZHVjdG9yLW1lcmNoOjg5OXU4Mjg3ejg3Ji9oaXVua2xsbmtqbml1ODc2OWcmLyZiaGJiZ2k3Ng==',
  productorEuipoAuth: process.env.PRODUCTOR_EUIPO_AUTH || 'Basic cHJvZHVjdG9yLW1lcmNoOjc4NzgyaWhvbG5zZmRiKC8mJi9pbzFubml1aDg3OGZhYnV6ZmFzYmprYmtqaGg3MDBoOQ==',
  productorDpmaAuth: process.env.PRODUCTOR_DPMA_AUTH || 'Basic cHJvZHVjdG9yLW1lcmNoOjcydWppaW9zZHBoaWhxMDg3MnIzMGc4YmJpJiZ1MWlpODE3Njdnejc2NzU2JTA3Z3V6YXNm',
  nasHost: process.env.NAS_HOST || '192.168.178.141',
  nasUser: process.env.NAS_USER || 'aljan92',
  autoSlotFillHour: Number(process.env.AUTO_SLOT_FILL_HOUR) || 4,
  autoSyncEnabled: true,
  mcpApiKey: process.env.MBA_MCP_API_KEY || '',
  aiAutonomyEnabled: false,
  queueUploadScheduleTime: 'off',
  queueMaxDropPerDesign: 10,
  queueAutoBalance: true,
  queueUploadMode: 'draft',
  queueDraftProductsPerDesign: 106,
  queueUpdateTargetCount: 10,
  queueUpdateAutoBackfillEnabled: false,
  queueUpdateMaxActiveProducts: 100,
  costPerImage: 0.08,
  costPerVectorization: 0.05,
};

function getSettingsFilePath(): string {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
      // ignore
    }
  }
  return path.join(dataDir, 'settings.json');
}

let cachedSettings: AppSettings | null = null;

export function loadSettings(): AppSettings {
  if (cachedSettings) {
    return cachedSettings;
  }
  const filePath = getSettingsFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const fileData = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(fileData);
      const settings = { ...DEFAULT_SETTINGS, ...parsed };
      if (!settings.mcpApiKey) {
        settings.mcpApiKey = generateApiKey();
        const merged = { ...DEFAULT_SETTINGS, ...parsed, mcpApiKey: settings.mcpApiKey };
        try {
          fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
        } catch (e) {}
      }
      cachedSettings = settings;
      return settings;
    } catch (err) {
      console.error('[Settings] Error reading settings.json:', err);
    }
  } else {
    const initialKey = generateApiKey();
    const settings = { ...DEFAULT_SETTINGS, mcpApiKey: initialKey };
    try {
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) {}
    cachedSettings = settings;
    return settings;
  }
  cachedSettings = { ...DEFAULT_SETTINGS };
  return cachedSettings;
}

export function saveSettings(newSettings: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const merged = { ...current, ...newSettings };
  cachedSettings = merged;
  const filePath = getSettingsFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    console.log('[Settings] Settings successfully saved to', filePath);
  } catch (err) {
    console.error('[Settings] Error saving settings.json:', err);
  }
  return merged;
}

export function getSupabaseClient(): SupabaseClient | null {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
    return null;
  }
  return createClient(settings.supabaseUrl.trim(), settings.supabaseServiceRoleKey.trim(), {
    auth: { persistSession: false }
  });
}
