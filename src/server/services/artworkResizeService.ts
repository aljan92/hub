import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ArtworkRenderSession } from './artworkRenderSession';
import { installArtworkRuntime } from './artworkRenderRuntime';
import { prepareBrushLayer } from './artworkBrushRuntime';
import { artworkProfiles, productProfile, validateProfile, ArtworkProfile } from './artworkProfiles';
import { ProductVariantGeneratorConfig } from './productCatalogService';
import { crc32, validateArtworkPng } from './artworkPngValidation';
const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

/**
 * Injects a 300 DPI (pHYs) chunk into a PNG buffer according to PNG specification
 */
export function inject300Dpi(pngBuffer: Buffer): Buffer {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (pngBuffer[i] !== sig[i]) return pngBuffer;
  }

  const dpi = 300;
  const ppm = Math.round(dpi * 39.3701); // 11811 pixels/meter
  const physData = Buffer.alloc(9);
  physData.writeUInt32BE(ppm, 0);
  physData.writeUInt32BE(ppm, 4);
  physData.writeUInt8(1, 8); // 1 = meters

  const typeAndData = Buffer.concat([Buffer.from('pHYs', 'ascii'), physData]);
  const crc = crc32(typeAndData);

  const chunkHeader = Buffer.alloc(4);
  chunkHeader.writeUInt32BE(9, 0); // length of data is 9

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  const physChunk = Buffer.concat([chunkHeader, typeAndData, crcBuf]);

  // Replace encoder-provided density rather than creating duplicate pHYs chunks.
  const chunks = [pngBuffer.subarray(0, 33), physChunk];
  for (let offset = 33; offset < pngBuffer.length;) {
    if (offset + 12 > pngBuffer.length) throw new Error('PNG-Chunk abgeschnitten');
    const end = offset + 12 + pngBuffer.readUInt32BE(offset);
    if (end > pngBuffer.length) throw new Error('PNG-Chunk abgeschnitten');
    if (pngBuffer.toString('ascii', offset + 4, offset + 8) !== 'pHYs') chunks.push(pngBuffer.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}


export type ArtworkSource = { kind: 'SVG'; svg: string } | { kind: 'PNG'; path: string };
export type ArtworkRenderProgress = (stage: 'BRUSH_PREPARATION' | 'VARIANT', detail: string, metrics?: Record<string, number>) => void;
export interface ResizedArtworksResult {
  /** Read compatibility only; new generations do not produce a trimmed PNG. */
  trimmedPath?: string;
  mugStandardPath: string; mugBrushPath: string; drinkwareStandardPath: string; drinkwareBrushPath: string;
  productVariants?: Record<string, string>;
  renderFingerprint?: string;
  renderFileHashes?: Record<string, string>;
}
export class ArtworkResizeService {
  public static getBrushTipPath(): string {
    const candidates = [
      path.resolve(process.cwd(), 'assets', 'brush_tip.png'),
      path.resolve(process.cwd(), 'dist', 'assets', 'brush_tip.png'),
      path.resolve(currentDir, '../../assets', 'brush_tip.png'),
      path.resolve(currentDir, '../assets', 'brush_tip.png'),
      path.resolve(process.cwd(), 'Erweiterungen und Programme /Listing Optimizer/assets', 'brush_tip.png')
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    return candidates[0];
  }


  static source(task: { svgContent?: string; localSvgPath?: string } | undefined, pngPath: string): ArtworkSource {
    if (task?.svgContent) return { kind: 'SVG', svg: task.svgContent };
    if (task?.localSvgPath) {
      if (!fs.existsSync(task.localSvgPath)) throw new Error('Freigegebene SVG-Datei fehlt; kein stiller PNG-Fallback.');
      return { kind: 'SVG', svg: fs.readFileSync(task.localSvgPath, 'utf8') };
    }
    return { kind: 'PNG', path: pngPath };
  }
  static fingerprint(source: ArtworkSource): string {
    return createHash('sha256').update('artwork-v6-direct-svg-png-canvas-stream-validation')
      .update(source.kind).update(source.kind === 'SVG' ? source.svg : fs.readFileSync(source.path))
      .update(JSON.stringify(artworkProfiles())).update(fs.readFileSync(this.getBrushTipPath())).digest('hex');
  }
  static hasCurrentAssets(assets: Partial<ResizedArtworksResult> | undefined, fingerprint: string): boolean {
    if (!assets || assets.renderFingerprint !== fingerprint) return false;
    return artworkProfiles().every(p => {
      const file = (assets as any)[p.key] || assets.productVariants?.[p.key];
      if (!file) return false;
      try { const fd=fs.openSync(file,'r'); const header=Buffer.alloc(24);
        try { fs.readSync(fd,header,0,24,0); } finally { fs.closeSync(fd); }
        return header.toString('hex',0,8)==='89504e470d0a1a0a' && header.readUInt32BE(16)===p.width && header.readUInt32BE(20)===p.height
          && assets.renderFileHashes?.[p.key] === createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      } catch { return false; }
    });
  }
  static async generateResizedArtworks(taskId: string, source: ArtworkSource | string, onProgress?: ArtworkRenderProgress): Promise<ResizedArtworksResult> {
    const input: ArtworkSource = typeof source === 'string' ? {kind:'PNG',path:source} : source;
    const fingerprint=this.fingerprint(input);
    const files=await this.renderProfiles(taskId,input,artworkProfiles(),onProgress,fingerprint);
    const { mugStandardPath, mugBrushPath, drinkwareStandardPath, drinkwareBrushPath, ...productVariants }=files;
    const renderFileHashes=Object.fromEntries(Object.entries(files).map(([key,file])=>[key,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
    return {mugStandardPath,mugBrushPath,drinkwareStandardPath,drinkwareBrushPath,productVariants,renderFingerprint:fingerprint,renderFileHashes};
  }
  static async generateProductVariant(taskId: string, source: ArtworkSource | string, id: string, config: ProductVariantGeneratorConfig) {
    const files=await this.renderProfiles(taskId,typeof source==='string'?{kind:'PNG',path:source}:source,[productProfile(id,config)]);
    return files[id];
  }
  static async generateAllProductVariants(taskId: string, source: ArtworkSource | string) {
    return this.renderProfiles(taskId,typeof source==='string'?{kind:'PNG',path:source}:source,artworkProfiles().filter(p=>!p.key.endsWith('Path')));
  }
  private static async renderProfiles(taskId: string, source: ArtworkSource, profiles: ArtworkProfile[], onProgress?: ArtworkRenderProgress, fingerprint?: string) {
    profiles.forEach(validateProfile);
    const cleanId=taskId.replace(/[^a-zA-Z0-9_-]/g,'_');
    const dir=path.resolve(process.cwd(),'data','designs'); fs.mkdirSync(dir,{recursive:true});
    const data=source.kind==='SVG'?source.svg:'data:image/png;base64,'+fs.readFileSync(source.path).toString('base64');
    return ArtworkRenderSession.run(async page=>{
      const geometry=await page.evaluate(installArtworkRuntime,{kind:source.kind,data});
      console.log('[ArtworkRenderer] Quelle',source.kind,geometry.bounds);
      if (profiles.some(p=>p.brush)) {
        onProgress?.('BRUSH_PREPARATION', '🖌️ Brush-Kontur wird vorbereitet…');
        await page.exposeFunction('__reportBrushStep', (detail: string) => {
          onProgress?.('BRUSH_PREPARATION', `🖌️ Brush: ${detail}…`);
        });
        const metrics = await page.evaluate(prepareBrushLayer, {
          brushUri: 'data:image/png;base64,'+fs.readFileSync(this.getBrushTipPath()).toString('base64'),
          seed: Number.parseInt((fingerprint || this.fingerprint(source)).slice(0, 8), 16)
        });
        console.log('[ArtworkRenderer] Brush-Teilschritte', JSON.stringify(metrics));
        onProgress?.('BRUSH_PREPARATION', `✓ Brush-Kontur vorbereitet (${(metrics.totalMs / 1000).toFixed(1)} s)`, metrics);
      }
      const files: Record<string,string>={};
      for(const profile of profiles) {
        onProgress?.('VARIANT', `🎨 Render ${profile.key} (${profile.width}×${profile.height})…`);
        const start=Date.now();
        const output=path.join(dir,cleanId+'_'+profile.suffix+'.png');
        const temporary=output+'.'+randomUUID()+'.tmp';
        let stage = 'RENDER';
        try {
          let png: Buffer;
          if (source.kind === 'PNG') {
            stage = 'PNG_CANVAS_RENDER_ENCODE';
            await page.setViewportSize({width:1,height:1});
            const base64 = await page.evaluate(p=>(window as any).__artwork.renderPng(p),profile);
            png = Buffer.from(base64, 'base64');
          } else {
            stage = 'SVG_CANVAS_RENDER_ENCODE';
            await page.setViewportSize({width:1,height:1});
            const base64 = await page.evaluate(p=>(window as any).__artwork.renderSvgPng(p),profile);
            png = Buffer.from(base64, 'base64');
          }
          stage = 'PNG_DPI_METADATA';
          const finalPng = inject300Dpi(png);
          stage = 'PNG_INTEGRITY_VALIDATION';
          await validateArtworkPng(finalPng, profile.width, profile.height);
          stage = 'FILE_COMMIT';
          fs.writeFileSync(temporary,finalPng); fs.renameSync(temporary,output);
          files[profile.key]=output;
          console.log('[ArtworkRenderer]',JSON.stringify({variant:profile.key,source:source.kind,width:profile.width,height:profile.height,ms:Date.now()-start,bytes:png.length}));
        } catch (error) {
          throw new Error(`${profile.key} (${profile.width}×${profile.height}, ${source.kind}) [${stage}]: ${error instanceof Error ? error.message : String(error)}`);
        } finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      }
      return files;
    });
  }
}
