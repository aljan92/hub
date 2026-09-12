import fs from 'fs';
import path from 'path';
import { LLMService } from './llmService';
import { loadSettings } from './settingsService';

export interface DesignerConcept {
  niche1: string;
  niche2?: string;
  subniche?: string;
  quote: string;
  style?: string;
  reasoning?: string;
}

export interface DesignerConceptHistoryItem {
  niche1: string;
  subniche?: string;
  quote: string;
  timestamp: number;
}

export interface GenerateConceptsOptions {
  prompt?: string;
  random?: boolean;
  count?: number;
}

export class DesignerConceptService {
  private static readonly HISTORY_FILE = path.resolve(process.cwd(), 'data/designer_concept_history.json');
  private static readonly MAX_HISTORY_ITEMS = 100;

  /**
   * Extracts the intended concept count from natural language text or requested count.
   * - "ein Design..." -> 1
   * - "5 Designs...", "zwei Konzepte..." -> explicit count
   * - "Designs...", "ein paar Designs..." (without number) -> 3
   * - random without count -> 1
   * - Clamped between 1 and 10.
   */
  public static extractConceptCount(prompt?: string, requestedCount?: number, isRandom = false): number {
    if (typeof requestedCount === 'number' && !isNaN(requestedCount) && requestedCount > 0) {
      return Math.max(1, Math.min(10, Math.round(requestedCount)));
    }

    const text = String(prompt || '').trim().toLowerCase();
    if (!text) {
      return isRandom ? 1 : 3;
    }

    // Check for explicit digit followed by concept keywords or at start
    const digitMatch = text.match(/(?:^|\b)(\d{1,2})\s*(?:designs?|konzepte?|ideen?|motive?|t-shirts?|stück)?\b/i);
    if (digitMatch && digitMatch[1]) {
      const parsed = parseInt(digitMatch[1], 10);
      if (parsed >= 1) return Math.max(1, Math.min(10, parsed));
    }

    // Check for "ein paar" or "mehrere" first (always 3)
    if (/\bein\s+paar\b|\bmehrere\b/i.test(text)) {
      return 3;
    }

    // Check for German number words (2 to 10)
    const multiNumberWords: Record<string, number> = {
      'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5, 'fuenf': 5,
      'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10
    };

    for (const [word, num] of Object.entries(multiNumberWords)) {
      if (new RegExp(`\\b${word}\\b`, 'i').test(text)) {
        return num;
      }
    }

    // Check for German singular number words "ein", "eine", etc.
    if (/\b(?:ein|eine|einen|einem|eines)\s+(?:design|konzept|idee|motiv|t-shirt)\b/i.test(text)) {
      return 1;
    }

    // Check for vague plural (designs, konzepte, etc.)
    if (/\b(?:designs|konzepte|ideen|motive|t-shirts)\b/i.test(text)) {
      return 3;
    }

    // Check for singular indicators
    if (/\b(?:design|konzept|idee|motiv|t-shirt)\b/i.test(text)) {
      return 1;
    }

    return isRandom ? 1 : 3;
  }

  /**
   * Loads the persistent concept history.
   */
  public static loadHistory(): DesignerConceptHistoryItem[] {
    try {
      if (!fs.existsSync(this.HISTORY_FILE)) {
        return [];
      }
      const raw = fs.readFileSync(this.HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Records newly generated concepts to the persistent history (rolling last 100 items).
   */
  public static recordConcepts(concepts: DesignerConcept[]): void {
    if (!concepts || concepts.length === 0) return;
    try {
      const history = this.loadHistory();
      const now = Date.now();
      for (const concept of concepts) {
        if (!concept.niche1 || !concept.quote) continue;
        history.push({
          niche1: concept.niche1,
          subniche: concept.subniche || undefined,
          quote: concept.quote,
          timestamp: now
        });
      }
      const trimmed = history.slice(-this.MAX_HISTORY_ITEMS);
      const dir = path.dirname(this.HISTORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[DesignerConceptService] Failed to record concept history:', err);
    }
  }

  /**
   * Clears the concept history.
   */
  public static clearHistory(): void {
    try {
      if (fs.existsSync(this.HISTORY_FILE)) {
        fs.unlinkSync(this.HISTORY_FILE);
      }
    } catch {}
  }

  /**
   * Returns a concise avoid list formatted for the LLM prompt.
   */
  public static getAvoidanceList(limit = 40): string[] {
    const history = this.loadHistory();
    const recent = history.slice(-limit);
    return recent.map(item => {
      const sub = item.subniche ? ` (${item.subniche})` : '';
      return `${item.niche1}${sub}: "${item.quote}"`;
    });
  }

  /**
   * Generates concepts based on prompt or random trigger.
   */
  public static async generateConcepts(options: GenerateConceptsOptions = {}): Promise<{
    concepts: DesignerConcept[];
    model: string;
    count: number;
  }> {
    const count = this.extractConceptCount(options.prompt, options.count, Boolean(options.random));
    const settings = loadSettings();
    const model = LLMService.normalizeModelId(settings.llmModel);
    const avoidanceList = this.getAvoidanceList(40);

    const isRandom = Boolean(options.random) || !options.prompt?.trim();
    const userPrompt = isRandom
      ? `Generate ${count} completely fresh, creative, top-converting commercial apparel design concept(s). Choose distinct broad high-volume evergreen niches.`
      : `User Request: "${options.prompt!.trim()}"\n\nGenerate exactly ${count} distinctive commercial apparel design concept(s) fulfilling this request.`;

    const concepts = await LLMService.generateDesignerConcepts({
      userPrompt,
      count,
      model,
      avoidanceList
    });

    // Record to history
    this.recordConcepts(concepts);

    return {
      concepts,
      model,
      count: concepts.length
    };
  }
}
