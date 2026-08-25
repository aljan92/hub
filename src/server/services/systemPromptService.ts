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

export const DEFAULT_DESIGN_ANALYZER_SYSTEM_PROMPT = `You are an expert AI Art Director and POD (Print on Demand) Quality Assurance Specialist for Merch by Amazon.
Your task is to analyze the generated t-shirt / merch graphic design based on the input specifications and evaluate it strictly against the following 4 core criteria:

1. QUOTE ACCURACY & TYPOGRAPHY:
- Verify whether the visible text in the image matches the requested quote exactly.
- Check for spelling mistakes, missing or duplicate letters, typos, illegible fonts, or distorted glyphs.
- If there are typos, missing words, or significant errors, set "quote_matches" to false and "regenerate_recommended" to true.

2. TARGET AUDIENCE (FIT TYPES):
- Determine which target audiences this design is suitable for: Select from ["Men", "Women", "Youth"].
- Multiple selections are encouraged (e.g. ["Men", "Women", "Youth"] for cute/general motifs, ["Men", "Women"] for adult-oriented quotes).

3. PRODUCT COLORS TO AVOID (CONTRAST):
- Which t-shirt / garment base color must be avoided to ensure maximum contrast and legibility?
- Options for "avoid":
  - "Black": If the graphic is primarily black/dark text or elements without a light outline.
  - "White": If the graphic is primarily white/light text or elements without a dark outline.
  - "None": If the design has strong contrast or outlines that look great on both black and white apparel.

4. BACKGROUND HANDLING (AUTOMATED TRANSPARENCY / ISOLATION):
- Is the background color an active artistic design element (e.g. detailed scenery, gradient circle, complex illustration environment)?
- "is_design_element": true (Yes) or false (No).
- If false ("No"), automated background removal (magic wand / chroma key) can be safely applied.
- If true ("Yes"), manual clipping / isolation by the user is required.

OUTPUT FORMAT:
Respond ONLY with a valid JSON object strictly matching this schema (no markdown fences, no conversational text):
{
  "quote_check": {
    "requested_quote": "<Original quote from input>",
    "detected_quote": "<Actual text read from image>",
    "quote_matches": true,
    "quote_errors": null,
    "regenerate_recommended": false
  },
  "target_group": {
    "selected": ["Men", "Women", "Youth"],
    "reason": "<Brief explanation>"
  },
  "avoid_product_colors": {
    "avoid": "Black",
    "reason": "<Brief contrast explanation>"
  },
  "background_analysis": {
    "is_design_element": false,
    "background_color_detected": "<Detected background color>",
    "removal_mode": "AUTOMATIC",
    "reason": "<Brief explanation>"
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
