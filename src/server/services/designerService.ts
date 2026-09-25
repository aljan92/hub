import crypto from 'crypto';
import { LLMService, type DesignerSuggestionField } from './llmService';
import { loadSettings } from './settingsService';
import { TaskLogService } from './taskLogService';
import { TaskRepository } from '../storage/taskRepository';

const DESIGN_FIELDS = ['niche1', 'niche2', 'subniche', 'quote', 'style'] as const;
const SUGGESTION_FIELDS = new Set<string>(DESIGN_FIELDS);

export type DesignerValues = Record<(typeof DESIGN_FIELDS)[number], string> & {
  customInstruction: string;
};

export class DesignerService {
  static normalizeValues(input: Record<string, unknown>): DesignerValues {
    const values = Object.fromEntries(DESIGN_FIELDS.map(field => [
      field,
      typeof input?.[field] === 'string' ? input[field].trim().replace(/\s+/g, ' ').slice(0, 300) : ''
    ])) as Record<(typeof DESIGN_FIELDS)[number], string>;
    if (!values.niche1) throw new Error('Niche 1 ist erforderlich.');
    const rawInstruction = input?.customInstruction ?? input?.custominstruction ?? input?.['custom instruction'];
    const customInstruction = typeof rawInstruction === 'string'
      ? rawInstruction.trim().slice(0, 1000)
      : '';
    return {
      ...values,
      customInstruction
    };
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
    const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(input.requestId) ? input.requestId : crypto.randomUUID();
    const imageProvider = input.imageProvider === 'GPT_IMAGE_2' ? 'GPT_IMAGE_2' : (input.imageProvider === 'IDEOGRAM_V4' ? 'IDEOGRAM_V4' : 'IDEOGRAM');
    const promptPoolEnabled = Boolean(input.promptPoolEnabled);
    const payload = { ...values, imageProvider, promptPoolEnabled };
    const inputHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const existing = TaskRepository.findDesignerRequest(requestId);
    if (existing) {
      if (existing.inputHash !== inputHash) throw new Error('Diese Startanfrage wurde bereits mit anderen Eingaben verwendet.');
      return { task: existing.task, duplicate: true };
    }

    const task = TaskLogService.createTaskLog({
      source: 'DESIGNER',
      payload,
      clientIp,
      requestIdentity: { id: requestId, inputHash }
    });
    return { task, duplicate: false };
  }

  static batchCreateTasks(input: {
    concepts: Record<string, unknown>[];
    imageProvider?: string;
    promptPoolEnabled?: boolean;
    clientIp?: string;
  }) {
    const list = Array.isArray(input.concepts) ? input.concepts : [];
    if (list.length === 0) throw new Error('Keine Konzepte zum Erstellen übergeben.');
    if (list.length > 10) throw new Error('Maximal 10 Konzepte pro Batch erlaubt.');
    const normalized = list.map(concept => this.normalizeValues(concept));
    const results: Array<{ task: any; duplicate: boolean }> = [];
    for (const [index, concept] of normalized.entries()) {
      const res = this.createTask({
        ...concept,
        requestId: list[index].requestId,
        imageProvider: input.imageProvider,
        promptPoolEnabled: input.promptPoolEnabled
      }, input.clientIp || 'local');
      results.push(res);
    }
    return results;
  }
}
