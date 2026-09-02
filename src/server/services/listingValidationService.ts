/**
 * Listing Validation & Placeholder Normalization Service
 * Ensures deterministic validation, repair, and sanitization of MBA listings
 * across both Update Pipeline and Design Pipeline.
 */

import { EnglishListing } from '../../types/tasks';
import { BannedWordsService } from './bannedWordsService';

export const PLACEHOLDER_TOKENS = new Set([
  'none',
  'n/a',
  'na',
  'null',
  'undefined',
  '-'
]);

export interface ListingValidationResult {
  isValid: boolean;
  issues: string[];
  repaired: boolean;
  listing: EnglishListing;
  expectedSuffix: string;
}

export class ListingValidationService {
  /**
   * Normalize optional text fields (niche2, subniche, etc.)
   * Case-insensitive, trimmed check against common placeholder strings.
   * Returns undefined if the string is empty or matches a placeholder token.
   */
  public static normalizeOptionalText(value: any): string | undefined {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    if (!str) return undefined;
    const lower = str.toLowerCase();
    if (PLACEHOLDER_TOKENS.has(lower)) {
      return undefined;
    }
    return str;
  }

  /**
   * Deterministically resolve the expected Title suffix:
   * 1. Valid normalized Subniche (if present)
   * 2. Otherwise valid normalized Niche2 (if present)
   * 3. Otherwise Niche1 (fallback to 'Graphic Art')
   */
  public static resolveExpectedTitleSuffix(params: {
    niche1?: string;
    niche2?: string;
    subniche?: string;
  }): string {
    const normSub = this.normalizeOptionalText(params.subniche);
    if (normSub) return normSub;
    const normN2 = this.normalizeOptionalText(params.niche2);
    if (normN2) return normN2;
    const normN1 = this.normalizeOptionalText(params.niche1);
    return normN1 || 'Graphic Art';
  }

  /**
   * Check if a Title ends with the expected suffix (or an accepted niche variant)
   */
  public static titleEndsWithSuffix(title: string, expectedSuffix: string, fallbackSuffixes: string[] = []): boolean {
    if (!title) return false;
    const clean = title.trim().toLowerCase().replace(/[,.!?:;'"\-–—]+$/, '').trim();
    const allExpected = [expectedSuffix, ...fallbackSuffixes]
      .map(s => this.normalizeOptionalText(s))
      .filter((s): s is string => !!s)
      .map(s => s.toLowerCase());

    for (const exp of allExpected) {
      if (clean === exp || clean.endsWith(' ' + exp)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Strip trailing placeholder tokens (e.g. " none", " null", " n/a") and trailing punctuation from Title
   */
  public static cleanTrailingPlaceholders(title: string): string {
    let clean = (title || '').trim();
    clean = clean.replace(/[,.!?:;'"\-–—]+$/, '').trim();

    // Regex to remove trailing standalone placeholder tokens like " none", " null", " n/a", " undefined", " -"
    const trailingPlaceholderRegex = /\s+(?:none|null|undefined|n\/a|na|-)$/i;
    while (trailingPlaceholderRegex.test(clean)) {
      clean = clean.replace(trailingPlaceholderRegex, '').trim();
      clean = clean.replace(/[,.!?:;'"\-–—]+$/, '').trim();
    }
    return clean;
  }

  /**
   * Hard constraint validation and deterministic repair for English Master Listings.
   * Runs after U4/D5 Master Listing generation and after EVERY Trademark Rewrite cycle.
   */
  public static validateAndRepairListing(params: {
    listing: EnglishListing;
    niche1?: string;
    niche2?: string;
    subniche?: string;
    forbiddenTerms?: string[];
  }): ListingValidationResult {
    const issues: string[] = [];
    let repaired = false;

    const raw = params.listing || {} as EnglishListing;
    let brand = String(raw.brand || '').trim();
    let title = String(raw.title || '').trim();
    let bullet1 = String(raw.bullet1 || '').trim();
    let bullet2 = String(raw.bullet2 || '').trim();
    let description = String(raw.description || '').trim();

    // 1. Resolve expected suffix
    const expectedSuffix = this.resolveExpectedTitleSuffix({
      niche1: params.niche1,
      niche2: params.niche2,
      subniche: params.subniche
    });
    const fallbackSuffixes = [
      this.normalizeOptionalText(params.subniche),
      this.normalizeOptionalText(params.niche2),
      this.normalizeOptionalText(params.niche1)
    ].filter((s): s is string => !!s);

    // 2. Clean trailing placeholders from title
    const titleBeforePlaceholderClean = title;
    title = this.cleanTrailingPlaceholders(title);
    if (title !== titleBeforePlaceholderClean) {
      issues.push(`Title contained trailing placeholder token: "${titleBeforePlaceholderClean}" -> "${title}"`);
      repaired = true;
    }

    // 3. Ensure Title ends with expected suffix without trailing punctuation
    title = title.replace(/[,.!?:;'"\-–—]+$/, '').trim();
    const hasValidSuffix = this.titleEndsWithSuffix(title, expectedSuffix, fallbackSuffixes);

    if (!hasValidSuffix) {
      issues.push(`Title did not end with expected suffix "${expectedSuffix}". Attempting repair.`);
      // If title can accommodate suffix within 60 chars
      const spaceNeeded = expectedSuffix.length + 1;
      if (title.length + spaceNeeded <= 60) {
        title = `${title} ${expectedSuffix}`;
        repaired = true;
      } else {
        // Trim prefix words so title ends strictly with expectedSuffix within 60 chars
        const maxPrefixLen = 60 - spaceNeeded;
        let prefix = title.slice(0, maxPrefixLen).trim();
        // Cut at last space to avoid half-words
        const lastSpace = prefix.lastIndexOf(' ');
        if (lastSpace > 20) {
          prefix = prefix.slice(0, lastSpace).trim();
        }
        prefix = prefix.replace(/[,.!?:;'"\-–—]+$/, '').trim();
        title = `${prefix} ${expectedSuffix}`.trim();
        repaired = true;
      }
    }

    // 4. Check Title length limit (Max 60 chars)
    if (title.length > 60) {
      issues.push(`Title exceeded 60 chars (${title.length} chars). Trimming while preserving suffix.`);
      // Preserve suffix at the end
      const matchedSuffix = fallbackSuffixes.find(s => title.toLowerCase().endsWith(s.toLowerCase())) || expectedSuffix;
      const spaceNeeded = matchedSuffix.length + 1;
      const maxPrefixLen = Math.max(10, 60 - spaceNeeded);
      let prefix = title.slice(0, title.length - matchedSuffix.length).trim();
      prefix = prefix.slice(0, maxPrefixLen).trim();
      const lastSpace = prefix.lastIndexOf(' ');
      if (lastSpace > 15) {
        prefix = prefix.slice(0, lastSpace).trim();
      }
      prefix = prefix.replace(/[,.!?:;'"\-–—]+$/, '').trim();
      title = `${prefix} ${matchedSuffix}`.trim().slice(0, 60);
      repaired = true;
    }

    // 5. Brand Hard Limits (Max 50 chars, target 40-50)
    brand = brand.replace(/[,.!?:;'"\-–—]+$/, '').trim();
    // Clean trailing placeholder tokens from Brand if any
    brand = this.cleanTrailingPlaceholders(brand);
    if (brand.length > 50) {
      issues.push(`Brand exceeded 50 chars (${brand.length} chars). Trimming.`);
      let cut = brand.slice(0, 50).trim();
      const lastSp = cut.lastIndexOf(' ');
      if (lastSp > 25) cut = cut.slice(0, lastSp).trim();
      brand = cut.replace(/[,.!?:;'"\-–—]+$/, '').trim();
      repaired = true;
    }

    // 6. Bullet 1 & Bullet 2 Limits (Max 256 chars, target 230-256)
    if (bullet1.length > 256) {
      issues.push(`Bullet 1 exceeded 256 chars (${bullet1.length} chars). Trimming.`);
      let cut = bullet1.slice(0, 256).trim();
      const lastPeriod = cut.lastIndexOf('.');
      if (lastPeriod > 200) {
        cut = cut.slice(0, lastPeriod + 1).trim();
      } else {
        const lastSp = cut.lastIndexOf(' ');
        if (lastSp > 200) cut = cut.slice(0, lastSp).trim();
      }
      bullet1 = cut;
      repaired = true;
    }

    if (bullet2.length > 256) {
      issues.push(`Bullet 2 exceeded 256 chars (${bullet2.length} chars). Trimming.`);
      let cut = bullet2.slice(0, 256).trim();
      const lastPeriod = cut.lastIndexOf('.');
      if (lastPeriod > 200) {
        cut = cut.slice(0, lastPeriod + 1).trim();
      } else {
        const lastSp = cut.lastIndexOf(' ');
        if (lastSp > 200) cut = cut.slice(0, lastSp).trim();
      }
      bullet2 = cut;
      repaired = true;
    }

    // 7. Description Limit (Max 600 chars, target 300-600)
    if (description.length > 600) {
      issues.push(`Description exceeded 600 chars (${description.length} chars). Trimming.`);
      let cut = description.slice(0, 600).trim();
      const lastPeriod = cut.lastIndexOf('.');
      if (lastPeriod > 400) {
        cut = cut.slice(0, lastPeriod + 1).trim();
      }
      description = cut;
      repaired = true;
    }

    // 8. Banned Words Check & Strip (Account Safety)
    const fieldsToClean = [
      { name: 'brand', val: brand, set: (v: string) => { brand = v; } },
      { name: 'title', val: title, set: (v: string) => { title = v; } },
      { name: 'bullet1', val: bullet1, set: (v: string) => { bullet1 = v; } },
      { name: 'bullet2', val: bullet2, set: (v: string) => { bullet2 = v; } },
      { name: 'description', val: description, set: (v: string) => { description = v; } }
    ];

    for (const f of fieldsToClean) {
      const foundBanned = BannedWordsService.findBannedWordsInText(f.val, 'en');
      if (foundBanned.length > 0) {
        issues.push(`Banned word(s) [${foundBanned.join(', ')}] detected in ${f.name}. Stripping.`);
        const cleaned = BannedWordsService.stripBannedWordsFromText(f.val, 'en');
        f.set(cleaned);
        repaired = true;
      }
    }

    // 9. Forbidden terms from TM Referee (Must not be present)
    if (params.forbiddenTerms && params.forbiddenTerms.length > 0) {
      const normForbidden = params.forbiddenTerms.map(t => t.toLowerCase().trim()).filter(Boolean);
      for (const f of fieldsToClean) {
        for (const term of normForbidden) {
          const esc = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`\\b${esc}\\b`, 'i');
          if (regex.test(f.val)) {
            issues.push(`Forbidden TM term "${term}" found in ${f.name}. Removing.`);
            f.set(f.val.replace(regex, '').replace(/\s+/g, ' ').trim());
            repaired = true;
          }
        }
      }
    }

    // Clean any trailing punctuation created by removals
    title = title.replace(/[,.!?:;'"\-–—]+$/, '').trim();
    brand = brand.replace(/[,.!?:;'"\-–—]+$/, '').trim();

    const finalListing: EnglishListing = {
      brand: brand.slice(0, 50),
      title: title.slice(0, 60),
      bullet1: bullet1.slice(0, 256),
      bullet2: bullet2.slice(0, 256),
      description: description.slice(0, 600)
    };

    const isValid =
      finalListing.brand.length >= 40 &&
      finalListing.brand.length <= 50 &&
      finalListing.title.length >= 50 &&
      finalListing.title.length <= 60 &&
      this.titleEndsWithSuffix(finalListing.title, expectedSuffix, fallbackSuffixes) &&
      !finalListing.title.toLowerCase().endsWith(' none') &&
      finalListing.bullet1.length >= 230 &&
      finalListing.bullet1.length <= 256 &&
      finalListing.bullet2.length >= 230 &&
      finalListing.bullet2.length <= 256 &&
      finalListing.description.length >= 300 &&
      finalListing.description.length <= 600;

    return {
      isValid,
      issues,
      repaired,
      listing: finalListing,
      expectedSuffix
    };
  }

  /**
   * Pure deterministic final validation immediately before queue handoff.
   * Does NOT rewrite, modify or generate any text.
   * Checks strict Amazon limits and safety constraints across master and all localized listings.
   */
  public static validateFinalListing(params: {
    listing: {
      brand?: string;
      title?: string;
      bullet1?: string;
      bullet2?: string;
      description?: string;
    };
    allListings?: Record<string, any>;
  }): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    const checkEntry = (prefix: string, data: Record<string, any>, locale: string) => {
      const title = String(data.title || '').trim();
      const brand = String(data.brand || '').trim();
      const bullet1 = String(data.bullet1 || data.bullet_1 || '').trim();
      const bullet2 = String(data.bullet2 || data.bullet_2 || '').trim();
      const description = String(data.description || '').trim();

      // Title checks
      if (!title) {
        errors.push(`${prefix} Title darf nicht leer sein.`);
      } else {
        if (title.length > 60) {
          errors.push(`${prefix} Title überschreitet 60 Zeichen (${title.length} Chars: "${title.slice(0, 30)}...")`);
        }
        if (/[,.!?:;'"\-–—]+$/.test(title)) {
          errors.push(`${prefix} Title darf nicht auf Satzzeichen enden ("${title}").`);
        }
        if (/\s+(?:none|null|undefined|n\/a|na|-)$/i.test(title)) {
          errors.push(`${prefix} Title enthält einen trailing Platzhalter-Token ("${title}").`);
        }
      }

      // Brand checks
      if (!brand) {
        errors.push(`${prefix} Brand darf nicht leer sein.`);
      } else if (brand.length > 50) {
        errors.push(`${prefix} Brand überschreitet 50 Zeichen (${brand.length} Chars: "${brand}")`);
      }

      // Bullets checks
      if (bullet1.length > 256) {
        errors.push(`${prefix} Bullet 1 überschreitet 256 Zeichen (${bullet1.length} Chars).`);
      }
      if (bullet2.length > 256) {
        errors.push(`${prefix} Bullet 2 überschreitet 256 Zeichen (${bullet2.length} Chars).`);
      }

      // Description check
      if (description.length > 600) {
        errors.push(`${prefix} Description überschreitet 600 Zeichen (${description.length} Chars).`);
      }

      // Banned words check
      const lang = locale === 'de' ? 'de' : 'en';
      const fields = [
        { name: 'Title', val: title },
        { name: 'Brand', val: brand },
        { name: 'Bullet 1', val: bullet1 },
        { name: 'Bullet 2', val: bullet2 },
        { name: 'Description', val: description }
      ];
      for (const f of fields) {
        if (f.val) {
          const banned = BannedWordsService.findBannedWordsInText(f.val, lang);
          if (banned.length > 0) {
            errors.push(`${prefix} ${f.name} enthält verbotene Wörter: [${banned.join(', ')}]`);
          }
        }
      }
    };

    // 1. Check master listing
    checkEntry('[Master]', params.listing, 'en');

    // 2. Check all localized listings if provided
    if (params.allListings && typeof params.allListings === 'object') {
      for (const [loc, locData] of Object.entries(params.allListings)) {
        if (locData && typeof locData === 'object') {
          checkEntry(`[${loc.toUpperCase()}]`, locData as Record<string, any>, loc);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
