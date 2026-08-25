import fs from 'fs';
import path from 'path';

export const DEFAULT_PROMPT_GENERATOR_SYSTEM_PROMPT = `You are an expert AI prompt engineer and Art Director specializing in print-on-demand (POD) automation for Merch by Amazon. Your goal is to convert the incoming design parameters (niche, quote, style, feeling, colors, instructions) into a highly descriptive, visually stunning, clean vector prompt tailored for Ideogram.

CORE RULES:
1. GRAPHIC STYLE: Enforce clean, bold vector illustration / graphic design suitable for t-shirt printing.
2. ISOLATION: The design must be isolated on a clean solid background with no realistic scene bleeding.
3. TYPOGRAPHY: If a quote or number is provided, ensure the text is spelled exactly as requested, styled with legible and impactful typography.
4. COMMERCIAL COMPLIANCE: Do not include trademarks, brand names, or protected phrases.

OUTPUT FORMAT:
Output ONLY the raw, optimized image generation prompt text. Do not include introductory text, explanations, or quotes around the whole prompt.`;

export const DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT = `Du bist ein hochqualifizierter Art Director und POD (Print on Demand) Qualitätsprüfer für Merch by Amazon.
Deine Aufgabe ist es, das generierte T-Shirt/Merch-Grafikdesign anhand der Vorgaben und der folgenden 4 Kernfragen präzise zu analysieren:

1. QUOTE- & TEXTPRÜFUNG:
- Prüfe, ob der Text im Bild exakt mit der angeforderten Quote übereinstimmt.
- Achte auf Rechtschreibfehler, fehlende oder doppelte Buchstaben, Tippfehler, unleserliche Schriftarten oder verzerrte Glyphen.
- Wenn Fehler vorliegen oder der Text wesentlich abweicht, setze "quote_matches" auf false und "regenerate_recommended" auf true.

2. ZIELGRUPPE (FIT TYPES):
- Bestimme die passenden Zielgruppen für dieses Design: Auswahl aus ["Men", "Women", "Youth"].
- Mehrfachauswahl ist ausdrücklich erwünscht (z.B. ["Men", "Women", "Youth"] für allgemeine/süße Motive, ["Men", "Women"] für typische Erwachsenen-Zitate).

3. VERMEIDBARE PRODUKTFARBEN (KONTRAST):
- Welche T-Shirt- bzw. Produkt-Grundfarben müssen vermieden werden, damit das Design optimal lesbar ist?
- Optionen für "avoid":
  - "Schwarz": Wenn das Design überwiegend aus schwarzer/dunkler Schrift oder Elementen ohne weiße Outline besteht.
  - "Weiß": Wenn das Design überwiegend aus weißer/heller Schrift ohne dunkle Outline besteht.
  - "Keine": Wenn das Design auf allen Textilfarben gut lesbar ist (z.B. dank Outlines/bunten Elementen).

4. HINTERGRUND-ELEMENT & TRANSPARENZ:
- Wird die Hintergrundfarbe aktiv als Design-Element verwendet (z.B. illustrierte Landschaft, Farbverlauf-Kreis, komplexe Szenerie)?
- "is_design_element": true (Ja) oder false (Nein).
- Wenn false ("Nein"), kann der Hintergrund automatisch transparent freigestellt werden.
- Wenn true ("Ja"), muss die Freistellung manuell durch den User erfolgen.

ANTWORTFORMAT:
Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt in folgendem Format (kein Markdown-Codeblock, kein Begleittext):
{
  "quote_check": {
    "requested_quote": "<Originale Quote aus dem Input>",
    "detected_quote": "<Tatsächlich im Bild erkannter Text>",
    "quote_matches": true,
    "quote_errors": null,
    "regenerate_recommended": false
  },
  "target_group": {
    "selected": ["Men", "Women", "Youth"],
    "reason": "<Kurze deutsche Begründung>"
  },
  "avoid_product_colors": {
    "avoid": "Schwarz",
    "reason": "<Kurze deutsche Begründung zum Kontrast>"
  },
  "background_analysis": {
    "is_design_element": false,
    "background_color_detected": "<Erkannte Hintergrundfarbe>",
    "removal_mode": "AUTOMATIC",
    "reason": "<Kurze deutsche Begründung>"
  },
  "overall_verdict": "APPROVED"
}`;

export class SystemPromptService {
  private static dataDir = path.resolve(process.cwd(), 'data');
  private static promptFile = path.resolve(process.cwd(), 'data', 'system_prompts.json');

  private static cachedPrompts: Record<string, string> | null = null;

  private static ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch (e) {}
    }
  }

  private static loadPrompts(): Record<string, string> {
    if (this.cachedPrompts !== null) {
      return this.cachedPrompts;
    }

    this.ensureDataDir();
    if (fs.existsSync(this.promptFile)) {
      try {
        const fileContent = fs.readFileSync(this.promptFile, 'utf-8');
        this.cachedPrompts = JSON.parse(fileContent);
        if (this.cachedPrompts) {
          if (!this.cachedPrompts.promptGenerator) {
            this.cachedPrompts.promptGenerator = DEFAULT_PROMPT_GENERATOR_SYSTEM_PROMPT;
          }
          if (!this.cachedPrompts.designAnalyzer) {
            this.cachedPrompts.designAnalyzer = DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT;
          }
          return this.cachedPrompts;
        }
      } catch (e) {
        console.error('[SystemPromptService] Failed to read system_prompts.json:', e);
      }
    }

    this.cachedPrompts = {
      promptGenerator: DEFAULT_PROMPT_GENERATOR_SYSTEM_PROMPT,
      designAnalyzer: DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT,
    };

    try {
      fs.writeFileSync(this.promptFile, JSON.stringify(this.cachedPrompts, null, 2), 'utf-8');
    } catch (e) {}

    return this.cachedPrompts;
  }

  static getPromptGeneratorPrompt(): string {
    const prompts = this.loadPrompts();
    return prompts.promptGenerator || DEFAULT_PROMPT_GENERATOR_SYSTEM_PROMPT;
  }

  static getDesignAnalyzerPrompt(): string {
    const prompts = this.loadPrompts();
    return prompts.designAnalyzer || DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT;
  }

  static getAllPrompts(): { promptGenerator: string; designAnalyzer: string } {
    const prompts = this.loadPrompts();
    return {
      promptGenerator: prompts.promptGenerator || DEFAULT_PROMPT_GENERATOR_SYSTEM_PROMPT,
      designAnalyzer: prompts.designAnalyzer || DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT,
    };
  }

  static savePrompts(updates: { promptGenerator?: string; designAnalyzer?: string }): void {
    this.ensureDataDir();
    const prompts = this.loadPrompts();
    if (typeof updates.promptGenerator === 'string') {
      prompts.promptGenerator = updates.promptGenerator;
    }
    if (typeof updates.designAnalyzer === 'string') {
      prompts.designAnalyzer = updates.designAnalyzer;
    }
    this.cachedPrompts = prompts;

    try {
      fs.writeFileSync(this.promptFile, JSON.stringify(prompts, null, 2), 'utf-8');
      console.log('[SystemPromptService] 💾 System-Prompts erfolgreich gespeichert.');
    } catch (e) {
      console.error('[SystemPromptService] Failed to save system_prompts.json:', e);
    }
  }

  static savePromptGeneratorPrompt(promptText: string): void {
    this.savePrompts({ promptGenerator: promptText });
  }

  static saveDesignAnalyzerPrompt(promptText: string): void {
    this.savePrompts({ designAnalyzer: promptText });
  }

  static resetToDefault(type: 'promptGenerator' | 'designAnalyzer' | 'all' = 'all'): { promptGenerator: string; designAnalyzer: string } {
    const current = this.loadPrompts();
    if (type === 'promptGenerator' || type === 'all') {
      current.promptGenerator = DEFAULT_PROMPT_GENERATOR_SYSTEM_PROMPT;
    }
    if (type === 'designAnalyzer' || type === 'all') {
      current.designAnalyzer = DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT;
    }
    this.cachedPrompts = current;
    try {
      fs.writeFileSync(this.promptFile, JSON.stringify(current, null, 2), 'utf-8');
    } catch (e) {}

    return {
      promptGenerator: current.promptGenerator,
      designAnalyzer: current.designAnalyzer,
    };
  }
}
