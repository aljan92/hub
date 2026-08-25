/**
 * Banned Words Service for Amazon Merch on Demand (MBA)
 * Curated from Productor and Listing Optimizer rules to prevent automated account flags,
 * policy rejections, and material/quality claim violations.
 */

export const BANNED_WORDS_BY_LOCALE: Record<string, string[]> = {
  en: [
    // Physical faux effects / Material claims (Forbidden on 2D prints)
    'sparkling',
    'glitter',
    'neon',
    'metallic',
    'foil',
    'rose gold',
    'gold',
    'glow effect',
    'glows in black light',
    'glow in the dark',
    'sequin',
    'metal',
    'wood',
    'diamond',
    'gem',
    'texture',
    'textured',
    'holographic',
    'embossed',
    'leather',
    'rubber',

    // Quality, Fit & Sizing claims
    'premium',
    'high quality',
    'quality',
    'fitted',
    'looser',
    'size up',
    'bigger size',
    'larger size',
    'maternity',
    'printed to be fitted',
    'printed in',
    'printed',
    'made in',

    // Shipping & Promotional promises
    'free shipping',
    'prime shipping',
    'ships in',
    'easy returns',
    'refund',
    'review',
    'risk free',
    'satisfaction guaranteed',
    'limited quantities',
    'best seller',
    'sale',
    'buy now',
    'discount',
    'trending',

    // Gift language (Amazon MBA policy flag)
    'gift',
    'present',
    'birthday gift',
    'christmas gift',

    // Product types in Title/Brand
    'popsocket',
    'pop socket',
    't-shirt',
    'tshirt',
    't shirt',
    'hoodie',
    'tank top',
    'sweatshirt',

    // Vulgar / Adult / Sensitive
    'fuck',
    'shit',
    'bitch',
    'btch',
    'dick',
    'penis',

    // Known Trap Trademarks
    'Steppenwolf',
    'Cycologist'
  ],

  de: [
    // Physische Material- & Effekt-Behauptungen
    'glitzernd',
    'Glitter',
    'Pailletten',
    'leuchtend',
    'leuchtet bei Schwarzlicht',
    'leuchtet im Dunkeln',
    'Neon',
    'Metallic',
    'Folie',
    'Roségold',
    'Gold',
    'Holz',
    'Metall',
    'Marmor',
    'Glas',
    'Leder',
    'Gummi',
    'Diamant',
    'Edelstein',
    'flauschig',
    'Plüsch',
    'geprägt',

    // Qualität & Passform
    'bewertung',
    'hohe qualität',
    'premium',
    'Schwangerschaftsbekleidung',
    'Übergröße',

    // Werbe- & Geschenk-Sprache
    'geschenk',
    'geburtstagsgeschenk',
    'weihnachtsgeschenk',
    'bester verkäufer',
    'rabatt',
    'jetzt kaufen',

    // Obszönitäten & Fallen
    'fuck',
    'btch',
    'bitch',
    'penis',
    'schießen',
    'Steppenwolf'
  ],

  fr: [
    'néon',
    'métallisé',
    "feuille d'aluminium",
    'rose',
    'étincelant',
    'brillant',
    'brillant à la lumière noire',
    'brillant dans l’obscurité',
    'métal',
    'marbre',
    'paillettes',
    'cuir',
    'caoutchouc',
    'pelucheuses',
    'fourrure',
    'verre',
    'diamant',
    'pierre précieuse',
    'cadeau',
    'nains'
  ],

  it: [
    'metallo',
    'marmo',
    'paillettes',
    'glitter',
    'pelle',
    'gomma',
    'pelo o pelliccia',
    'perline',
    'diamanti',
    'gemme',
    'fluo',
    'metallico',
    'laminato',
    'oro rosa',
    'oro',
    'brillante',
    'fosforescente',
    'fluorescente alla luce nera',
    'luminoso al buio',
    'regalo',
    'Benito Mussolini',
    'Benito',
    'Mussolini',
    'anos'
  ],

  es: [
    'papel de aluminio',
    'oro rosa',
    'oro',
    'brillante',
    'brillo en luz negra',
    'brillo en la oscuridad',
    'como madera',
    'metal',
    'mármol',
    'lentejuelas',
    'purpurina',
    'cuero',
    'caucho',
    'tejido o peludo',
    'vidrio',
    'diamantes o gemas',
    'regalo',
    'primer'
  ],

  ja: [
    'チビ',
    'ジン',
    'シン',
    'アタリ',
    'アタ',
    'ギフト',
    'プレゼント',
    '高品質',
    'プレミアム'
  ]
};

export class BannedWordsService {
  /**
   * Get banned words array for a specific locale (defaulting to English if not found)
   */
  static getBannedWords(locale: string = 'en'): string[] {
    const norm = locale.toLowerCase().trim();
    return BANNED_WORDS_BY_LOCALE[norm] || BANNED_WORDS_BY_LOCALE.en || [];
  }

  /**
   * Generate formatted Markdown section to append to the Listing Generator system prompt
   */
  static getBannedWordsPromptSection(): string {
    const enWords = this.getBannedWords('en').join(', ');
    const deWords = this.getBannedWords('de').join(', ');

    return `### 4. STRICT BLACKLIST / BANNED WORDS (ACCOUNT SAFETY - ZERO TOLERANCE):
You MUST NEVER use any of the following prohibited words or phrases in ANY field (Brand, Title, Bullet 1, Bullet 2, Description) under ANY circumstances:

A. FAUX MATERIAL & PHYSICAL EFFECT CLAIMS (CRITICAL! DO NOT DESCRIBE 2D ARTWORK AS PHYSICAL MATERIALS):
- English: sparkling, glitter, neon, metallic, foil, rose gold, gold, glow effect, glows in black light, glow in the dark, sequin, metal, wood, diamond, gem, texture, textured, holographic, embossed, leather, rubber.
- German: glitzernd, Glitter, Pailletten, leuchtend, Neon, Metallic, Folie, Roségold, Gold, Holz, Metall, Marmor, Glas, Leder, Diamant, Edelstein.

B. QUALITY, FIT & SIZING CLAIMS:
- English: premium, high quality, quality, fitted, looser, size up, bigger size, larger size, maternity, printed in, made in.
- German: hohe qualität, premium, bewertung, Schwangerschaftsbekleidung.

C. PROMOTIONAL & GIFT LANGUAGE:
- English: gift, present, birthday gift, christmas gift, best seller, sale, buy now, discount.
- German: geschenk, geburtstagsgeschenk, weihnachtsgeschenk, rabatt.

D. PRODUCT TYPE IN TITLE/BRAND:
- NO words like: "T-Shirt", "tshirt", "shirt", "hoodie", "tank top", "popsocket", "pop socket".

E. ALL PROHIBITED WORDS LIST:
- [EN]: ${enWords}
- [DE]: ${deWords}`;
  }

  /**
   * Scan text for banned words in a given language locale
   */
  static findBannedWordsInText(text: string, locale: string = 'en'): string[] {
    if (!text || typeof text !== 'string') return [];
    const words = this.getBannedWords(locale);
    const found: string[] = [];

    const isJapanese = locale === 'ja';

    for (const w of words) {
      const escaped = w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = isJapanese
        ? new RegExp(escaped, 'gi')
        : new RegExp(`\\b${escaped}\\b`, 'gi');

      if (regex.test(text)) {
        found.push(w);
      }
    }

    return Array.from(new Set(found));
  }

  /**
   * Validate full multi-language listing payload and return any detected banned words
   */
  static validateListing(listing: Record<string, any>): Record<string, { field: string; foundWords: string[] }[]> {
    const issuesByLocale: Record<string, { field: string; foundWords: string[] }[]> = {};

    if (!listing || typeof listing !== 'object') return issuesByLocale;

    for (const [loc, fields] of Object.entries(listing)) {
      if (fields && typeof fields === 'object') {
        const localeIssues: { field: string; foundWords: string[] }[] = [];
        for (const [fieldName, val] of Object.entries(fields)) {
          if (typeof val === 'string') {
            const found = this.findBannedWordsInText(val, loc);
            if (found.length > 0) {
              localeIssues.push({ field: fieldName, foundWords: found });
            }
          }
        }
        if (localeIssues.length > 0) {
          issuesByLocale[loc] = localeIssues;
        }
      }
    }

    return issuesByLocale;
  }
}
