/** Runs only inside the isolated render page. SVG content is decoded as an image,
 * never inserted into the executable page DOM. No persistent trimmed raster. */
export async function installArtworkRuntime(params: { kind: 'SVG' | 'PNG'; data: string; masterWidth?: number; masterHeight?: number }) {
  const load = async (uri: string) => { const img = new Image(); img.src = uri; await img.decode(); return img; };
  const encode = (text: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const wrap = (width: number, height: number, body: string, box = `0 0 ${width} ${height}`) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box}">${body}</svg>`;
  let width: number, height: number, body: string, uri: string;
  let decodedImage: HTMLImageElement | undefined;
  if (params.kind === 'SVG') {
    const document = new DOMParser().parseFromString(params.data, 'image/svg+xml');
    const root = document.documentElement;
    if (root.localName !== 'svg' || document.querySelector('parsererror')) throw new Error('Ungültige SVG-Quelle');
    // Self-contained vectorizer output is expected. Never fetch fonts/images/URLs.
    for (const el of Array.from(root.querySelectorAll('*')).concat(root)) {
      if (['script', 'foreignObject'].includes(el.localName)) throw new Error('Aktiver SVG-Inhalt nicht erlaubt');
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) throw new Error('SVG-Eventhandler nicht erlaubt');
        if ((attr.localName === 'href' && !/^(#|data:image\/)/i.test(attr.value))
          || /url\(\s*['"]?(?!#|data:)[^\s)]/i.test(attr.value) && /(?:https?:|file:|\/\/)/i.test(attr.value)) throw new Error('Externe SVG-Ressource nicht erlaubt');
      }
    }
    if (/@import|url\(\s*['"]?(?:https?:|file:|\/\/)/i.test(params.data)) throw new Error('Externe SVG-Ressource nicht erlaubt');
    width = params.masterWidth || 4500; height = params.masterHeight || 5400;
    // Same centered 90% container as the existing master renderer.
    root.setAttribute('x', String((width - Math.round(width * .9)) / 2)); root.setAttribute('y', String((height - Math.round(height * .9)) / 2));
    root.setAttribute('width', String(Math.round(width * .9))); root.setAttribute('height', String(Math.round(height * .9)));
    (root as unknown as SVGSVGElement).style.setProperty('width', `${Math.round(width * .9)}px`);
    (root as unknown as SVGSVGElement).style.setProperty('height', `${Math.round(height * .9)}px`);
    body = new XMLSerializer().serializeToString(root);
    uri = encode(wrap(width, height, body));
  } else {
    const img = await load(params.data);
    decodedImage = img;
    width = img.naturalWidth; height = img.naturalHeight;
    if (width * height > 100_000_000) throw new Error('PNG-Quelle überschreitet Pixelbudget');
    body = `<image width="${width}" height="${height}" href="${xml(params.data)}"/>`;
    uri = params.data;
  }
  const image = decodedImage || await load(uri);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  canvas.width = 0; canvas.height = 0;
  if (right < left) throw new Error('Artwork ist vollständig transparent');
  const bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  // Cropping changes coordinates only; the original SVG remains vector content.
  const crop = (w: number, h: number) => wrap(w, h, body, `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
  const state: any = { kind: params.kind, bounds, wrap, encode, xml, load, crop, brush: null };
  // Brush masks are raster effects at source resolution. Reuse the already decoded
  // source; never wrap a large PNG into SVG and decode it a second time for this.
  // The final SVG foreground remains vector content in state.render below.
  state.createBrushSource = () => {
    const source = document.createElement('canvas');
    source.width = bounds.width; source.height = bounds.height;
    const context = source.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Brush-Canvas konnte nicht erstellt werden');
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    return source;
  };
  const placements = (profile: any) => profile.boxes.map((box: any) => {
    const brush = profile.brush ? state.brush : null;
    if (profile.brush && !brush) throw new Error('Brush-Ebene fehlt');
    const bw = brush?.width || bounds.width, bh = brush?.height || bounds.height;
    const scale = Math.min(box.width / bw, box.height / bh, params.kind === 'PNG' ? 1 : Infinity);
    const dw = bw * scale, dh = bh * scale;
    let x = box.x + (box.width - dw) / 2, y = box.y + (box.height - dh) / 2;
    if (params.kind === 'PNG' && scale === 1) { x = Math.round(x); y = Math.round(y); }
    const offset = brush?.padding || 0;
    const artX = params.kind === 'PNG' && scale === 1 ? Math.round(x + offset) : x + offset * scale;
    const artY = params.kind === 'PNG' && scale === 1 ? Math.round(y + offset) : y + offset * scale;
    return { brush, scale, dw, dh, x, y, artX, artY };
  });
  // PNG input is already rasterized. Avoid a target-sized SVG image, screenshot
  // and second image decode: encode one canvas, then release its backing store.
  let brushImage: HTMLImageElement | undefined;
  let brushUri: string | undefined;
  state.renderPng = async (profile: any) => {
    if (params.kind !== 'PNG' || profile.master) throw new Error('Direkter PNG-Renderer benötigt ein PNG-Variantenprofil');
    const target = document.createElement('canvas');
    target.width = profile.width; target.height = profile.height;
    try {
      const context = target.getContext('2d');
      if (!context) throw new Error('Ausgabe-Canvas konnte nicht erstellt werden');
      if (profile.background) { context.fillStyle = profile.background; context.fillRect(0, 0, target.width, target.height); }
      for (const p of placements(profile)) {
        if (p.brush) {
          if (brushUri !== p.brush.uri) { brushImage = await load(p.brush.uri); brushUri = p.brush.uri; }
          context.drawImage(brushImage!, p.x, p.y, p.dw, p.dh);
        }
        context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height,
          p.artX, p.artY, bounds.width * p.scale, bounds.height * p.scale);
      }
      const result = target.toDataURL('image/png');
      if (!result.startsWith('data:image/png;base64,')) throw new Error('PNG-Canvas konnte nicht kodiert werden');
      return result.slice('data:image/png;base64,'.length);
    } finally { target.width = 0; target.height = 0; }
  };
  state.render = async (profile: any) => {
    const { width: w, height: h } = profile;
    let content = profile.background ? `<rect width="100%" height="100%" fill="${xml(profile.background)}"/>` : '';
    if (profile.master) {
      content += `<svg width="${w}" height="${h}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
    } else {
      for (const { brush, scale, dw, dh, x, y, artX, artY } of placements(profile)) {
        if (brush) content += `<image x="${x}" y="${y}" width="${dw}" height="${dh}" href="${xml(brush.uri)}"/>`;
        content += `<svg x="${artX}" y="${artY}" width="${bounds.width * scale}" height="${bounds.height * scale}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}">${body}</svg>`;
      }
    }
    const output = document.getElementById('output') as HTMLImageElement;
    output.style.width = `${w}px`; output.style.height = `${h}px`;
    output.src = encode(wrap(w, h, content));
    await output.decode();
  };
  (window as any).__artwork = state;
  return { width, height, bounds, kind: params.kind };
}
