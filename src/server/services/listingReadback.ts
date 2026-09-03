export interface ListingFieldExpectation {
  locale: string;
  field: string;
  value: string;
}

export function buildListingExpectations(listings: Record<string, any>, translated: boolean): ListingFieldExpectation[] {
  const fields = [
    ['brandName', 'brand', 50], ['title', 'title', 60],
    ['featureBullet1', 'bullet1', 256], ['featureBullet2', 'bullet2', 256],
    ['description', 'description', 2000]
  ] as const;
  return (translated ? ['en', 'de', 'fr', 'it', 'es', 'ja'] : ['en']).flatMap(locale => {
    const content = listings[locale] || (locale === 'ja' ? listings.jp : null) || listings.en;
    if (!content) throw new Error(`FAILED_LISTING_INTEGRITY: ${locale}: Listing fehlt`);
    return fields.map(([field, source, limit]) => {
      const value = String(content[source] ?? '');
      if (value.length > limit) throw new Error(`FAILED_LISTING_INTEGRITY: ${locale}/${field}: ${value.length} Zeichen überschreiten Limit ${limit}; kein stilles Kürzen.`);
      return { locale, field, value };
    });
  });
}

/** Self-contained browser function, passed directly to Playwright evaluate. */
export async function verifyListingReadback({ expectations, timeoutMs = 5000 }: {
  expectations: ListingFieldExpectation[]; timeoutMs?: number;
}): Promise<{ success: boolean; errors: string[]; verifiedFields: number }> {
  const deadline = Date.now() + timeoutMs;
  let stablePasses = 0;
  let errors: string[] = [];
  let verifiedFields = 0;
  do {
    errors = [];
    verifiedFields = 0;
    for (const expected of expectations) {
      const id = `designCreator-productEditor-${expected.field}`;
      const locales = ['en', 'de', 'fr', 'it', 'es', 'ja', 'jp'];
      let candidates = Array.from(document.querySelectorAll(`[id="${expected.locale}"] [id="${id}"]`));
      if (!candidates.length && expected.locale === 'en') {
        candidates = Array.from(document.querySelectorAll(`[id="${id}"]`)).filter(el =>
          !locales.some(locale => el.closest(`[id="${locale}"]`))
        );
      }
      const inputs = candidates.filter((el): el is HTMLInputElement | HTMLTextAreaElement =>
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      );
      const name = `${expected.locale.toUpperCase()}/${expected.field}`;
      if (inputs.length === 0) {
        // Optional empty fields may legitimately be absent from Amazon's form.
        if (expected.value !== '') errors.push(`${name}: Feld fehlt`);
      } else if (inputs.length !== 1) {
        errors.push(`${name}: Feld nicht eindeutig (${inputs.length} Treffer)`);
      } else {
        if (inputs[0].value.replace(/\r\n?/g, '\n') !== expected.value.replace(/\r\n?/g, '\n')) {
          errors.push(`${name}: Text weicht vom Soll ab (Soll ${expected.value.length}, Ist ${inputs[0].value.length} Zeichen)`);
        } else verifiedFields++;
      }
    }
    stablePasses = errors.length === 0 ? stablePasses + 1 : 0;
    if (stablePasses >= 2) return { success: true, errors: [], verifiedFields };
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  return { success: false, errors: errors.length ? errors : ['Listing-Zustand noch nicht stabil bestätigt'], verifiedFields };
}
