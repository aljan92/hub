import crypto from 'crypto';
import { LLMService, type DesignerSuggestionField } from './llmService';
import { loadSettings } from './settingsService';
import { TaskLogService } from './taskLogService';

const DESIGN_FIELDS = ['niche1', 'niche2', 'subniche', 'quote', 'style'] as const;
const SUGGESTION_FIELDS = new Set<string>(DESIGN_FIELDS);
const recentCreations = new Map<string, { createdAt: number; task: any }>();

export type DesignerValues = Record<(typeof DESIGN_FIELDS)[number], string>;

export class DesignerService {
  static normalizeValues(input: Record<string, unknown>): DesignerValues {
    const values = Object.fromEntries(DESIGN_FIELDS.map(field => [
      field,
      typeof input?.[field] === 'string' ? input[field].trim().replace(/\s+/g, ' ').slice(0, 300) : ''
    ])) as DesignerValues;
    if (!values.niche1) throw new Error('Niche 1 ist erforderlich.');
    return values;
  }

  static normalizeSuggestionRequest(input: Record<string, unknown>) {
    const field = String(input?.field || '');
    if (!SUGGESTION_FIELDS.has(field)) throw new Error('Unbekanntes Vorschlagsfeld.');
    const rawValues = input?.values && typeof input.values === 'object' ? input.values as Record<string, unknown> : {};
    const values = Object.fromEntries(DESIGN_FIELDS.map(key => [
      key,
      typeof rawValues[key] === 'string' ? rawValues[key].trim().replace(/\s+/g, ' ').slice(0, 300) : ''
    ])) as DesignerValues;
    if (field !== 'niche1' && !values.niche1) throw new Error('Bitte zuerst Niche 1 ausfüllen.');
    const avoid = Array.isArray(input?.avoid)
      ? input.avoid.filter((value): value is string => typeof value === 'string').map(value => value.trim().slice(0, 120)).filter(Boolean).slice(-5)
      : [];
    return { field: field as DesignerSuggestionField, values, avoid };
  }

  static async suggest(input: Record<string, unknown>) {
    const { field, values, avoid } = this.normalizeSuggestionRequest(input);
    const settings = loadSettings();
    const requestedModel = typeof input.model === 'string' ? input.model.trim().slice(0, 200) : '';
    return LLMService.generateDesignerSuggestion({
      field,
      ...values,
      avoid,
      model: requestedModel || settings.designerSuggestionModel || settings.llmModel
    });
  }

  static createTask(input: Record<string, unknown>, clientIp: string) {
    const values = this.normalizeValues(input);
    const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(input.requestId)
      ? input.requestId
      : crypto.randomUUID();
    const now = Date.now();
    for (const [key, entry] of recentCreations) {
      if (now - entry.createdAt > 10 * 60 * 1000) recentCreations.delete(key);
    }
    const existing = recentCreations.get(requestId);
    if (existing) return { task: existing.task, duplicate: true };

    const task = TaskLogService.createTaskLog({
      source: 'DESIGNER',
      payload: {
        ...values,
        imageProvider: input.imageProvider === 'GPT_IMAGE_2' ? 'GPT_IMAGE_2' : 'IDEOGRAM',
        promptPoolEnabled: Boolean(input.promptPoolEnabled)
      },
      clientIp
    });
    recentCreations.set(requestId, { createdAt: now, task });
    return { task, duplicate: false };
  }
}
