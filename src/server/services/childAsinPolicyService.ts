export type ChildAsinPolicy = 'identity' | 'resolve' | 'unsupported';

export const LEGACY_CHILD_ASIN_PRODUCT_TYPES = new Set([
  'HARDCOVER_JOURNAL',
  'MUG',
  'PHONE_CASE_APPLE_IPHONE',
  'POP_SOCKET',
  'PRINTED_BASEBALL_HAT',
  'PRINTED_TRUCKER_HAT',
  'SPORT_SUN_VISOR',
  'THROW_PILLOW',
  'TOTE_BAG',
  'TUMBLER',
  'WATER_BOTTLE'
]);

export const NEW_CHILD_ASIN_PRODUCT_TYPES = new Set([
  'SPORT_BACKPACK',
  'LAPTOP_SLEEVE',
  'MOUSE_PAD',
  'RETRACTABLE_PEN',
  'THROW_BLANKET',
  'MATTE_POSTER',
  'TRAVEL_TUMBLER'
]);

export const UNSUPPORTED_CHILD_ASIN_PRODUCT_TYPES = new Set([
  'PHONE_CASE_SAMSUNG_GALAXY',
  'SAMSUNG_CASE'
]);

export const IDENTITY_CHILD_ASIN_PRODUCT_TYPES = new Set([
  'STANDARD_TSHIRT', 'VALUE_TSHIRT', 'VALUE_GRAPHIC_TSHIRT', 'PREMIUM_TSHIRT',
  'PERFORMANCE_TSHIRT', 'BASEBALL_JERSEY', 'SOCCER_JERSEY', 'BASKETBALL_JERSEY',
  'OVERSIZED_TSHIRT', 'COMFORT_COLORS_HEAVYWEIGHT_TSHIRT', 'CROP_TOP',
  'COMFORT_COLORS_SWEATSHIRT', 'COMFORT_COLORS_CROP_SWEATSHIRT', 'VNECK',
  'VNECK_TSHIRT', 'TANK_TOP', 'STANDARD_LONG_SLEEVE', 'LONG_SLEEVE_TSHIRT',
  'RAGLAN', 'STANDARD_SWEATSHIRT', 'SWEATSHIRT', 'STANDARD_PULLOVER_HOODIE',
  'PULLOVER_HOODIE', 'ZIP_HOODIE', 'PERFORMANCE_HOODIE', 'POLO',
  'PERFORMANCE_POLO', 'QUARTER_ZIP', 'PERFORMANCE_QUARTER_ZIP'
]);

const PRODUCT_TYPE_ALIASES: Record<string, string> = {
  SAMSUNG_CASE: 'PHONE_CASE_SAMSUNG_GALAXY'
};

export function normalizeChildAsinProductType(value: unknown): string {
  const normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return PRODUCT_TYPE_ALIASES[normalized] || normalized;
}

export function getChildAsinPolicy(value: unknown): ChildAsinPolicy {
  const type = normalizeChildAsinProductType(value);
  if (UNSUPPORTED_CHILD_ASIN_PRODUCT_TYPES.has(type)) return 'unsupported';
  if (LEGACY_CHILD_ASIN_PRODUCT_TYPES.has(type) || NEW_CHILD_ASIN_PRODUCT_TYPES.has(type)) return 'resolve';
  if (IDENTITY_CHILD_ASIN_PRODUCT_TYPES.has(type)) return 'identity';
  return 'unsupported';
}

/** Legacy HTML resolver scope; the SNAP resolver handles every resolve policy. */
export function isLegacyChildAsinWriteEnabled(value: unknown): boolean {
  return LEGACY_CHILD_ASIN_PRODUCT_TYPES.has(normalizeChildAsinProductType(value));
}

export function isNewChildAsinShadowType(value: unknown): boolean {
  return NEW_CHILD_ASIN_PRODUCT_TYPES.has(normalizeChildAsinProductType(value));
}

export function isConfirmedChildAsin(asin: unknown, parentAsin: unknown): boolean {
  const child = String(asin || '').trim().toUpperCase();
  const parent = String(parentAsin || '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(child) && /^[A-Z0-9]{10}$/.test(parent) && child !== parent;
}

export function isChildAsinRequirementSatisfied(entry: any): boolean {
  const policy = getChildAsinPolicy(entry?.type);
  if (policy !== 'resolve') return true;
  return isConfirmedChildAsin(entry?.asin, entry?.parentAsin);
}
