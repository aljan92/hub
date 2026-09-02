/**
 * Central Listing Sanitization Service
 * 
 * Exactly ONE canonical sanitizing implementation for all MBA Hub listing text.
 * Strictly preserves:
 * - German Umlaute (ä, ö, ü, Ä, Ö, Ü, ß)
 * - French, Spanish, Italian accents (é, è, ç, ñ, í, etc.)
 * - Japanese Kana & Kanji (\u4e00-\u9fa0, \u3041-\u3093, etc.) and full-width numbers
 * 
 * Normalizes:
 * - Smart / typographic quotes to standard ASCII quotes
 * - Smart / typographic single quotes to standard apostrophes
 * - En/Em dashes and minus signs to standard hyphens
 * - Ellipsis to three dots
 * - Non-breaking and special spaces to standard ASCII spaces
 * - Strips prohibited control / obscure characters not supported by Amazon Merch
 */

export class ListingSanitizationService {
  // Amazon Merch allowed charset regex (preserves Latin, European accents, Japanese scripts, punctuation)
  private static readonly PROHIBITED_CHARS_REGEX = /[^ -)+-\u00ad\u00af-\u00ff\u1e9e\u20ac\u017d\u0160\u0161\u017e\u0152\u0153\u0178\u4e00-\u9fa0\u3041-\u3093\u3094\u30a1-\u30f4\u30fc\u3005\u3006\u3024\uff41-\uff5a\uff21-\uff3a\uff10-\uff19\u2460-\u2473\u3001-\uff3d\u300c\u300d\u00b0\u2032\u2033\u3000\u2013\u201c\u201d\u2018\u2019\u2026]/g;

  /**
   * Sanitize an individual string field according to Amazon Merch rules
   */
  public static sanitizeText(text: string | null | undefined): string {
    if (!text) return '';
    let cleaned = String(text);

    // 1. Replace typographic double quotes with standard quotes
    cleaned = cleaned.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u275D\u275E]/g, '"');

    // 2. Replace typographic single quotes with standard apostrophes
    cleaned = cleaned.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u275B\u275C]/g, "'");

    // 3. Replace em/en dashes and minus signs with standard hyphens
    cleaned = cleaned.replace(/[\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');

    // 4. Replace ellipsis with three dots
    cleaned = cleaned.replace(/\u2026/g, '...');

    // 5. Replace non-breaking and special spaces with standard space
    cleaned = cleaned.replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

    // 6. Clean prohibited characters using Amazon's character set
    cleaned = cleaned.replace(this.PROHIBITED_CHARS_REGEX, '');

    // 7. Collapse multiple whitespace and trim
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  /**
   * Sanitize an entire listing object (title, brand, bullet1, bullet2, description)
   */
  public static sanitizeListing<T extends Record<string, any>>(listing: T): T {
    if (!listing || typeof listing !== 'object') return listing;
    const result: Record<string, any> = { ...listing };

    for (const [k, v] of Object.entries(listing)) {
      if (typeof v === 'string') {
        result[k] = this.sanitizeText(v);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        result[k] = this.sanitizeListing(v);
      }
    }

    return result as T;
  }

  /**
   * Sanitize all localized listings in a listings record (e.g. { en: {...}, de: {...}, fr: {...} })
   */
  public static sanitizeAllListings(listings: Record<string, any>): Record<string, any> {
    if (!listings || typeof listings !== 'object') return {};
    const sanitized: Record<string, any> = {};

    for (const [locale, data] of Object.entries(listings)) {
      if (data && typeof data === 'object') {
        sanitized[locale.toLowerCase()] = this.sanitizeListing(data);
      }
    }

    return sanitized;
  }
}
