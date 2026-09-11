import type { Page } from 'playwright';
import { BrowserSessionService } from './browserSessionService';

export type RetailIdentitySource =
  | 'hidden-input'
  | 'detail-bullets'
  | 'product-details'
  | 'selected-variation'
  | 'default-asin'
  | 'single-variation-map';

export interface RetailIdentityEvidence {
  requestedParentAsin: string;
  resolvedAsin: string;
  marketplace: string;
  source: RetailIdentitySource;
  finalUrl: string;
  httpStatus: number;
}

export type RetailIdentityResult =
  | { status: 'resolved'; evidence: RetailIdentityEvidence }
  | { status: 'parent_returned' | 'identity_not_found' | 'ambiguous' | 'http_not_found' | 'auth_required' | 'amazon_blocked' | 'timeout' | 'network_error'; error?: string; httpStatus?: number; finalUrl?: string };

const MARKETPLACE_DOMAINS: Record<string, string> = {
  us: 'amazon.com', de: 'amazon.de', gb: 'amazon.co.uk', uk: 'amazon.co.uk',
  fr: 'amazon.fr', it: 'amazon.it', es: 'amazon.es', jp: 'amazon.co.jp'
};

function normalizeAsin(value: unknown): string {
  const asin = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : '';
}

function uniqueAsins(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeAsin).filter(Boolean)));
}

function extractSection(html: string, ids: string[]): string {
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`<[^>]+id=["']${escaped}["'][^>]*>`, 'i').exec(html);
    if (match) return html.slice(match.index, match.index + 12_000);
  }
  return '';
}

function asinFromLabeledText(value: string): string[] {
  const text = value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ');
  return uniqueAsins(Array.from(text.matchAll(/\bASIN\b[^A-Z0-9]{0,40}(B[A-Z0-9]{9})/gi), match => match[1]));
}

export function parseAmazonRetailIdentity(html: string): { asin: string; source: RetailIdentitySource } | { asin: ''; ambiguous: boolean } {
  const hidden = uniqueAsins(Array.from(html.matchAll(/<input\b[^>]*>/gi), match => {
    const tag = match[0];
    if (!/\bid=["']ASIN["']/i.test(tag)) return '';
    return tag.match(/\bvalue=["']([A-Z0-9]{10})["']/i)?.[1] || '';
  }));
  if (hidden.length === 1) return { asin: hidden[0], source: 'hidden-input' };
  if (hidden.length > 1) return { asin: '', ambiguous: true };

  const bullets = asinFromLabeledText(extractSection(html, ['detailBulletsWrapper_feature_div', 'detailBullets_feature_div']));
  if (bullets.length === 1) return { asin: bullets[0], source: 'detail-bullets' };
  if (bullets.length > 1) return { asin: '', ambiguous: true };

  const details = asinFromLabeledText(extractSection(html, ['productDetails_detailBullets_sections1', 'productDetails']));
  if (details.length === 1) return { asin: details[0], source: 'product-details' };
  if (details.length > 1) return { asin: '', ambiguous: true };

  const selected = uniqueAsins(Array.from(html.matchAll(/"selectedVariationASIN"\s*:\s*"([A-Z0-9]{10})"/g), match => match[1]));
  if (selected.length === 1) return { asin: selected[0], source: 'selected-variation' };
  if (selected.length > 1) return { asin: '', ambiguous: true };

  const defaults = uniqueAsins(Array.from(html.matchAll(/data-defaultAsin=["']([A-Z0-9]{10})["']/g), match => match[1]));
  if (defaults.length === 1) return { asin: defaults[0], source: 'default-asin' };
  if (defaults.length > 1) return { asin: '', ambiguous: true };

  const mapped: unknown[] = [];
  for (const match of html.matchAll(/"dimensionToAsinMap"\s*:\s*({[^}]+})/g)) {
    try { mapped.push(...Object.values(JSON.parse(match[1]))); } catch {}
  }
  for (const match of html.matchAll(/"asinToDimension"\s*:\s*({[^}]+})/g)) {
    try { mapped.push(...Object.keys(JSON.parse(match[1]))); } catch {}
  }
  const candidates = uniqueAsins(mapped);
  if (candidates.length === 1) return { asin: candidates[0], source: 'single-variation-map' };
  return { asin: '', ambiguous: candidates.length > 1 };
}

function detectsAmazonBlock(html: string): boolean {
  return /errors\/validateCaptcha|Robot Check|robot-check|api-services-support@amazon/i.test(html);
}

function detectsAuthPage(url: string, html: string): boolean {
  return /\/ap\/signin|\/gp\/signin/i.test(url) || /id=["']ap_email["']|name=["']password["']/i.test(html);
}

export class AmazonRetailIdentityService {
  static async resolve(parentAsin: string, marketplace: string): Promise<RetailIdentityResult> {
    const parent = normalizeAsin(parentAsin);
    const market = String(marketplace || '').toLowerCase() === 'uk' ? 'gb' : String(marketplace || '').toLowerCase();
    const domain = MARKETPLACE_DOMAINS[market];
    if (!parent || !domain) return { status: 'identity_not_found', error: 'Ungültige Parent-ASIN oder Marketplace.' };

    const url = `https://www.${domain}/dp/${parent}`;
    try {
      return await BrowserSessionService.withIsolatedPage('sync', async (page: Page) => {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const httpStatus = response?.status() || 0;
        const finalUrl = page.url();
        if (httpStatus === 404) return { status: 'http_not_found', httpStatus, finalUrl };
        const html = await page.content();
        let finalHost = '';
        try { finalHost = new URL(finalUrl).hostname; } catch {}
        if (finalHost !== `www.${domain}` && finalHost !== domain) {
          if (detectsAuthPage(finalUrl, html)) return { status: 'auth_required', httpStatus, finalUrl };
          return { status: 'network_error', error: 'Unerwartetes Redirect-Ziel.', httpStatus, finalUrl };
        }
        if (html.length > 8 * 1024 * 1024) return { status: 'identity_not_found', error: 'Amazon-Dokument überschreitet 8 MiB.', httpStatus, finalUrl };
        if (detectsAmazonBlock(html) || httpStatus === 403 || httpStatus === 503) return { status: 'amazon_blocked', httpStatus, finalUrl };
        if (detectsAuthPage(finalUrl, html)) return { status: 'auth_required', httpStatus, finalUrl };
        const parsed = parseAmazonRetailIdentity(html);
        if (!('source' in parsed)) return { status: parsed.ambiguous ? 'ambiguous' : 'identity_not_found', httpStatus, finalUrl };
        if (parsed.asin === parent) return { status: 'parent_returned', httpStatus, finalUrl };
        return { status: 'resolved', evidence: { requestedParentAsin: parent, resolvedAsin: parsed.asin, marketplace: market, source: parsed.source, finalUrl, httpStatus } };
      });
    } catch (error: any) {
      if (/Timeout/i.test(error?.name || '') || /timeout/i.test(error?.message || '')) return { status: 'timeout', error: error.message };
      return { status: 'network_error', error: error?.message || String(error) };
    }
  }
}
