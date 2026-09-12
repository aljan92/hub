import { getGeneratableVariants, resolveBackgroundColor, ProductVariantGeneratorConfig } from './productCatalogService';

export interface ArtworkProfile {
  key: string; suffix: string; width: number; height: number;
  background?: string; brush?: boolean; master?: boolean;
  boxes: Array<{ x: number; y: number; width: number; height: number }>;
}

export function normalizeBackgroundHex(color?: string): string | undefined {
  if (!color || typeof color !== 'string') return undefined;
  const trimmed = color.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return `#${trimmed.toUpperCase()}`;
  }
  return undefined;
}

export function productProfile(id: string, config: ProductVariantGeneratorConfig, overrideBackground?: string): ArtworkProfile {
  const { width, height } = config.canvas;
  const padding = Math.min(width, height) * config.paddingShortSidePct;
  const normalizedOverride = normalizeBackgroundHex(overrideBackground);
  return { key: id, suffix: id.toLowerCase(), width, height, background: normalizedOverride || resolveBackgroundColor(config),
    boxes: [{ x: padding, y: padding, width: width - 2 * padding, height: height - 2 * padding }] };
}

export function artworkProfiles(overrideBackground?: string): ArtworkProfile[] {
  // Technical composition geometry, not product routing. Preserve the legacy placements.
  const twoSided = (key: string, suffix: string, width: number, height: number, side: number, xs: number[], brush: boolean) => {
    const margin = side * 0.075;
    return { key, suffix, width, height, brush,
      boxes: xs.map(x => ({ x: x + margin, y: (height - side) / 2 + margin, width: side - 2 * margin, height: side - 2 * margin })) };
  };
  const mugSide = 1045.646;
  const mugXs = [59, 1591].map(x => x + (1050 - mugSide) / 2);
  return [
    twoSided('mugStandardPath', 'two_sided_mug_standard', 2700, 1050, mugSide, mugXs, false),
    twoSided('mugBrushPath', 'two_sided_mug_brush', 2700, 1050, mugSide, mugXs, true),
    twoSided('drinkwareStandardPath', 'two_sided_drinkware_standard', 3000, 1400, 1400, [31, 1566.6667], false),
    twoSided('drinkwareBrushPath', 'two_sided_drinkware_brush', 3000, 1400, 1400, [31, 1566.6667], true),
    ...getGeneratableVariants().map(v => productProfile(v.id, v.generator!, overrideBackground))
  ];
}

export function validateProfile(p: ArtworkProfile) {
  if (!/^[a-z0-9_-]+$/.test(p.suffix) || ![p.width, p.height].every(n => Number.isSafeInteger(n) && n > 0) || p.width * p.height > 100_000_000
    || p.boxes.some(b => ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0)) {
    throw new Error(`Ungültiges Artwork-Profil: ${p.key}`);
  }
}
