import fs from 'fs';
import path from 'path';
import { randomInt } from 'node:crypto';
import { LLMService } from './llmService';
import { loadSettings } from './settingsService';

export interface DesignerConcept {
  niche1: string;
  niche2?: string;
  subniche?: string;
  quote: string;
  style?: string;
  customInstruction?: string;
  reasoning?: string;
}

export interface DesignerConceptHistoryItem {
  niche1: string;
  subniche?: string;
  quote: string;
  timestamp: number;
  source?: 'random';
  family?: string;
}

export interface GenerateConceptsOptions {
  prompt?: string;
  random?: boolean;
  count?: number;
}

export class DesignerConceptService {
  // The former file mixed random suggestions with user-directed ideas and cannot be classified safely.
  private static readonly HISTORY_FILE = path.resolve(process.cwd(), 'data/designer_random_concept_history.json');
  private static readonly MAX_HISTORY_ITEMS = 100;
  private static readonly RANDOM_FAMILIES = [
    'outdoor activities', 'music and performing arts', 'science and astronomy',
    'crafts and creative hobbies', 'food and cooking', 'travel and places',
    'sports and fitness', 'gardening and nature', 'family occasions',
    'animal interests', 'skilled trades', 'technology and gaming'
  ];

  private static pickRandomFamilies(count: number, history: DesignerConceptHistoryItem[]): string[] {
    const recent = history.filter(item => item.source === 'random' && item.family).slice(-40);
    const lastSeen = new Map<string, number>();
    recent.forEach((item, index) => lastSeen.set(item.family!, index));
    const candidates = [...this.RANDOM_FAMILIES];
    const selected: string[] = [];
    while (selected.length < count) {
      const oldest = Math.min(...candidates.map(family => lastSeen.get(family) ?? -1));
      const tied = candidates.filter(family => (lastSeen.get(family) ?? -1) === oldest);
      const family = tied[randomInt(tied.length)];
      selected.push(family);
      candidates.splice(candidates.indexOf(family), 1);
      if (candidates.length === 0) candidates.push(...this.RANDOM_FAMILIES);
    }
    return selected;
  }

  private static conceptKey(value: string): string {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private static hasRecentDuplicate(concepts: DesignerConcept[], history: DesignerConceptHistoryItem[]): boolean {
    const recent = history.filter(item => item.source === 'random').slice(-40);
    const niches = new Set(recent.map(item => this.conceptKey(item.niche1)));
    const quotes = new Set(recent.map(item => this.conceptKey(item.quote)));
    for (const concept of concepts) {
      const niche = this.conceptKey(concept.niche1);
      const quote = this.conceptKey(concept.quote);
      if (niches.has(niche) || quotes.has(quote)) return true;
      niches.add(niche);
      quotes.add(quote);
    }
    return false;
  }

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
  public static recordConcepts(concepts: DesignerConcept[], families: string[] = []): void {
    if (!concepts || concepts.length === 0) return;
    try {
      const history = this.loadHistory();
      const now = Date.now();
      for (const [index, concept] of concepts.entries()) {
        if (!concept.niche1 || !concept.quote) continue;
        history.push({
          niche1: concept.niche1,
          subniche: concept.subniche || undefined,
          quote: concept.quote,
          timestamp: now,
          source: 'random',
          family: families[index]
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
    const recent = history.filter(item => item.source === 'random').slice(-limit);
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
    const isRandom = Boolean(options.random) || !options.prompt?.trim();
    const history = isRandom ? this.loadHistory() : [];
    const families = isRandom ? this.pickRandomFamilies(count, history) : [];
    const avoidanceList = isRandom ? this.getAvoidanceList(40) : [];
    const userPrompt = isRandom
      ? `Generate ${count} fresh commercial apparel concept(s). Use these distinct theme families in order: ${families.map((family, index) => `${index + 1}: ${family}`).join('; ')}. Do not default to pets, jobs or birthdays unless their family is explicitly assigned. Each concept must use its assigned family and a different primary niche.`
      : `User Request: "${options.prompt!.trim()}"\n\nGenerate exactly ${count} distinctive commercial apparel design concept(s) fulfilling this request.`;

    let concepts = await LLMService.generateDesignerConcepts({
      userPrompt,
      count,
      model,
      avoidanceList
    });

    if (isRandom && (concepts.length !== count || this.hasRecentDuplicate(concepts, history))) {
      concepts = await LLMService.generateDesignerConcepts({
        userPrompt: `${userPrompt}\n\nThe prior response was incomplete or repeated a recent niche or slogan. Return exactly ${count} different concepts with different niches and slogans.`,
        count,
        model,
        avoidanceList
      });
      if (concepts.length !== count || this.hasRecentDuplicate(concepts, history)) throw new Error('Zufallskonzepte sind unvollständig oder wiederholen zuletzt verwendete Nischen oder Slogans. Bitte erneut versuchen.');
    }

    // User-directed ideas are never written to the random concept history.
    if (isRandom) this.recordConcepts(concepts, families);

    return {
      concepts,
      model,
      count: concepts.length
    };
  }
}
