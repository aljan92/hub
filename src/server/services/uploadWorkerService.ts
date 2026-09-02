import path from 'path';
import fs from 'fs';
import { BrowserSessionService } from './browserSessionService';
import { QueueService, QueueItem, ProductUploadResult, ProductUploadStatus, UploadResultSummary } from './queueService';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
import { ArtworkResizeService } from './artworkResizeService';
import { SyncEngine } from './syncEngine';
import { Page } from 'playwright';

export interface UploadProgressState {
  isUploading: boolean;
  isPausedBeforePublish?: boolean;
  currentQueueId: string | null;
  taskId: string | null;
  designTitle: string | null;
  mode: 'draft' | 'publish';
  currentStep: string;
  stepIndex: number;
  totalSteps: number;
  percent: number;
  logs: string[];
  error?: string;
}

export class UploadWorkerService {
  private static isUploading = false;
  private static isPausedBeforePublish = false;
  private static pauseBeforePublishRequested = false;
  private static resumePublishResolver: (() => void) | null = null;
  private static currentQueueId: string | null = null;
  private static currentTaskId: string | null = null;
  private static currentDesignTitle: string | null = null;
  private static currentMode: 'draft' | 'publish' = 'draft';
  private static currentStep = 'Bereit';
  private static stepIndex = 0;
  private static totalSteps = 100;
  private static logs: string[] = [];
  private static abortRequested = false;
  private static statusListeners: ((state: UploadProgressState) => void)[] = [];

  /**
   * Register listener for progress updates (broadcasted to WebSockets)
   */
  public static onStatusUpdate(callback: (state: UploadProgressState) => void) {
    this.statusListeners.push(callback);
    callback(this.getStatus());
  }

  /**
   * Get current upload status
   */
  public static getStatus(): UploadProgressState {
    const percent = this.totalSteps > 0 ? Math.min(100, Math.round((this.stepIndex / this.totalSteps) * 100)) : 0;
    return {
      isUploading: this.isUploading,
      isPausedBeforePublish: this.isPausedBeforePublish,
      currentQueueId: this.currentQueueId,
      taskId: this.currentTaskId,
      designTitle: this.currentDesignTitle,
      mode: this.currentMode,
      currentStep: this.currentStep,
      stepIndex: this.stepIndex,
      totalSteps: this.totalSteps,
      percent,
      logs: this.logs.slice(-30)
    };
  }

  private static log(message: string, stepName?: string, currentStep?: number, totalSteps?: number) {
    const timestamp = new Date().toLocaleTimeString('de-DE');
    const logEntry = `[${timestamp}] ${message}`;
    this.logs.push(logEntry);
    if (this.logs.length > 200) this.logs.shift();

    if (stepName) this.currentStep = stepName;
    if (currentStep !== undefined) this.stepIndex = currentStep;
    if (totalSteps !== undefined) this.totalSteps = totalSteps;

    console.log(`[UploadWorker] ${message}`);
    this.broadcastStatus();
  }

  private static broadcastStatus() {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {}
    }
  }

  /**
   * Cancel currently running upload
   */
  public static cancelUpload(): boolean {
    if (!this.isUploading) return false;
    this.abortRequested = true;
    if (this.resumePublishResolver) {
      this.isPausedBeforePublish = false;
      this.resumePublishResolver();
      this.resumePublishResolver = null;
    }
    this.log('🛑 Upload-Abbruch angefordert...', 'Wird abgebrochen...');
    return true;
  }

  /**
   * Resume upload that was paused before publish in inspection mode
   */
  public static resumeAndPublish(): { success: boolean; message: string } {
    if (!this.isUploading || !this.isPausedBeforePublish || !this.resumePublishResolver) {
      return { success: false, message: 'Kein pausierter Upload-Vorgang im Prüfmodus aktiv.' };
    }
    this.log('🚀 Prüfmodus: Klick auf Publish vom Benutzer freigegeben!', 'Veröffentliche...');
    const resolver = this.resumePublishResolver;
    this.resumePublishResolver = null;
    this.isPausedBeforePublish = false;
    resolver();
    return { success: true, message: 'Publish wird ausgeführt...' };
  }

  /**
   * Start upload for a specific queue item or next item in queue
   */
  public static async startUpload(
    queueItemId?: string, 
    mode: 'draft' | 'publish' = 'draft',
    pauseBeforePublish = false
  ): Promise<{ success: boolean; message: string }> {
    if (this.isUploading) {
      return { success: false, message: 'Es läuft bereits ein Upload-Vorgang.' };
    }

    const state = QueueService.getState();
    const queueMode = state.uploadMode || 'draft';
    let targetItem: QueueItem | undefined;

    const isUpdate = (i: any) => (i.type === 'UPDATE' || i.type === 'update' || i.source === 'UPDATE' || Boolean(i.designId) || (i.taskId && String(i.taskId).endsWith('-U')));

    if (queueItemId) {
      targetItem = state.items.find(i => i.id === queueItemId);
    } else {
      const newWaiting = state.items.filter(i => i.status === 'WAITING' && !i.isPaused && !isUpdate(i));
      const updateWaiting = state.items.filter(i => i.status === 'WAITING' && !i.isPaused && isUpdate(i));

      if (queueMode === 'hybrid') {
        // Hybrid: Prio 1 Updates (Live), Prio 2 New Designs (Draft)
        targetItem = updateWaiting.length > 0 ? updateWaiting[0] : newWaiting[0];
      } else if (queueMode === 'live') {
        // Live: Prio 1 New Designs (Live with slots), Prio 2 Updates
        const newWithSlots = newWaiting.filter(i => (i.allocatedSlots && i.allocatedSlots > 0));
        targetItem = newWithSlots.length > 0 ? newWithSlots[0] : updateWaiting[0];
      } else {
        // Draft: Only New Designs as Draft
        targetItem = newWaiting.length > 0 ? newWaiting[0] : undefined;
      }
    }

    if (!targetItem) {
      return { success: false, message: 'Kein bereitstehendes Design in der Queue gefunden.' };
    }

    const isUpdateItem = isUpdate(targetItem);
    // Update designs are ALWAYS Live (publish). New designs follow queueMode or passed mode.
    const effectiveMode: 'draft' | 'publish' = isUpdateItem ? 'publish' : (queueMode === 'live' || mode === 'publish' ? 'publish' : 'draft');

    this.isUploading = true;
    this.isPausedBeforePublish = false;
    this.pauseBeforePublishRequested = Boolean(pauseBeforePublish);
    this.resumePublishResolver = null;
    this.abortRequested = false;
    this.currentQueueId = targetItem.id;
    this.currentTaskId = targetItem.taskId;
    this.currentDesignTitle = targetItem.title || targetItem.designTitle;
    this.currentMode = effectiveMode;
    this.stepIndex = 0;
    this.totalSteps = 100;
    this.logs = [];

    // Mark as UPLOADING in queue
    QueueService.updateItemStatus(targetItem.id, 'UPLOADING');

    // Run upload execution asynchronously
    this.executeUploadPipeline(targetItem, effectiveMode).catch(err => {
      console.error('[UploadWorker] Critical pipeline error:', err);
    });

    return { success: true, message: `Upload für Task #${targetItem.taskId} gestartet (${effectiveMode.toUpperCase()} Modus${isUpdateItem ? ' • Update' : ''}).` };
  }

  /**
   * Cleans text to strictly conform to Amazon Merch on Demand character requirements:
   * - Converts typographic quotes („ “ ” « ») to standard ASCII quotes (")
   * - Converts curly single quotes/apostrophes (’ ‘ ‚ ‛) to standard ASCII apostrophe (')
   * - Converts typographic hyphens/dashes (— – −) to standard ASCII hyphen (-)
   * - Converts ellipsis (…) to (...)
   * - Removes any other prohibited unicode characters not allowed on Amazon Merch
   */
  public static sanitizeListingText(text: string, locale = 'en'): string {
    if (!text) return '';
    let cleaned = text;

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
    const prohibitedRegex = /[^ -)+-\u00ad\u00af-\u00ff\u1e9e\u20ac\u017d\u0160\u0161\u017e\u0152\u0153\u0178\u4e00-\u9fa0\u3041-\u3093\u3094\u30a1-\u30f4\u30fc\u3005\u3006\u3024\uff41-\uff5a\uff21-\uff3a\uff10-\uff19\u2460-\u2473\u3001-\uff3d\u300c\u300d\u00b0\u2032\u2033\u3000\u2013\u201c\u201d\u2018\u2019\u2026]/g;
    cleaned = cleaned.replace(prohibitedRegex, '');

    // 7. Collapse multi-spaces
    cleaned = cleaned.replace(/\s+/g, ' ');

    return cleaned.trim();
  }

  /**
   * Main Upload Execution Pipeline
   */
  private static async executeUploadPipeline(item: QueueItem, mode: 'draft' | 'publish') {
    const isUpdate = (item as any).type === 'UPDATE' || (item as any).type === 'update' || (item as any).source === 'UPDATE' || Boolean(item.designId) || item.taskId.endsWith('-U');
    const effectiveMode: 'draft' | 'publish' = isUpdate ? 'publish' : mode; // Update designs are ALWAYS live!
    const cleanDesignId = item.designId || item.taskId.replace(/^#/, '').replace(/-U$/, '');
    const uploadUrl = isUpdate 
      ? `https://merch.amazon.com/designs/${cleanDesignId}/edit` 
      : 'https://merch.amazon.com/designs/new';

    try {
      this.log(`🚀 Starte Upload für Task #${item.taskId} ("${item.title || item.designTitle}")${isUpdate ? ' [UPDATE-MODUS]' : ''}`, 'Initialisiere Session 2...', 5, 100);

      // 1. Ensure Session 2 (Upload) is active
      const session = await BrowserSessionService.getSession('upload');
      const page = session.page;

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 2. Navigate to Create or Edit Page
      this.log(`🌐 Öffne ${uploadUrl}`, isUpdate ? 'Öffne Merch Edit Seite...' : 'Öffne Merch Create Seite...', 10, 100);
      await page.goto(uploadUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);

      // Check for login required
      const currentUrl = page.url();
      if (currentUrl.includes('/signin') || currentUrl.includes('/ap/signin')) {
        this.log(`⚠️ Amazon Login erforderlich. Bitte im Screencast (Session 2) einloggen!`, 'Warte auf Login...');
        // Wait up to 3 minutes for user to sign in
        await page.waitForURL('**/designs/**', { timeout: 180000 });
        this.log(`✅ Login erkannt! Fahre mit Upload fort...`, 'Login erfolgreich');
      }

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 3. Prepare PNG File (if applicable)
      let pngAbsolutePath = '';
      if (item.pngPath && fs.existsSync(item.pngPath)) {
        pngAbsolutePath = path.resolve(item.pngPath);
      } else {
        // Fallback checks
        const candidatePaths = [
          path.resolve(process.cwd(), 'data', 'designs', `${item.taskId}.png`),
          path.resolve(process.cwd(), 'data', 'designs', `${item.taskId.replace('#', '')}.png`),
          path.resolve(process.cwd(), 'data', 'designs', `${item.taskId}_mba_print.png`),
          path.resolve(process.cwd(), 'data', 'designs', `${item.taskId}_master.png`),
          path.resolve(process.cwd(), 'data', 'designs', `${cleanDesignId}.png`),
          path.resolve(process.cwd(), 'data', 'designs', `${cleanDesignId}_master.png`)
        ];
        for (const cp of candidatePaths) {
          if (fs.existsSync(cp)) {
            pngAbsolutePath = cp;
            break;
          }
        }
      }

      // 4. Handle Artwork
      if (isUpdate) {
        this.log(`ℹ️ [UPDATE-MODUS] Bestehendes Listing wird bearbeitet – Artwork ist bereits auf Amazon vorhanden.`, 'Update Modus', 25, 100);
      } else {
        if (!pngAbsolutePath || !fs.existsSync(pngAbsolutePath)) {
          throw new Error(`Druckfertige 4500x5400px PNG-Datei für Task #${item.taskId} nicht gefunden.`);
        }
        this.log(`📤 Lade Master-PNG hoch (${path.basename(pngAbsolutePath)})...`, 'Lade PNG hoch...', 20, 100);
        const fileInput = await page.waitForSelector('.dropzone-container input[type="file"], input[type="file"].file-upload-input, input[type="file"]', { 
          state: 'attached', 
          timeout: 20000 
        });
        if (!fileInput) {
          throw new Error('Upload-Feld (input[type="file"]) nicht im DOM gefunden.');
        }
        await fileInput.setInputFiles(pngAbsolutePath);
        this.log(`⏳ PNG zugewiesen. Warte auf vollständiges Amazon-Asset-Rendering...`, 'Warte auf Rendering...', 25, 100);

        // Wait for artwork to render on any product card or global asset container
        try {
          await page.waitForFunction(() => {
            const img = document.querySelector('[id$="-card"] .asset img, .product-card .asset img, .asset img, #global-uploader-container img.artwork') as HTMLImageElement;
            return img && (img.complete || (img.naturalWidth && img.naturalWidth > 0) || (img.src && img.src.length > 0));
          }, { timeout: 60000 });

          // Check rate limit warning if present
          const rateLimit = await page.$('.daily-rate-limit-breached');
          if (rateLimit) {
            throw new Error('Tägliches Amazon Upload-Limit erreicht (.daily-rate-limit-breached).');
          }
          this.log(`✅ Master-PNG erfolgreich gerendert!`, 'PNG Upload fertig ✓', 35, 100);
        } catch (err: any) {
          if (err.message && err.message.includes('Limit')) throw err;
          this.log(`⚠️ Render-Check beendet, fahre fort...`);
        }
      }

      // 5. Select Products Modal (Intelligent Double-Check Selection)
      this.log(`📦 Öffne 'Select Products' Modal...`, 'Konfiguriere Marktplätze...', 40, 100);
      await page.waitForTimeout(2000);

      // Robust Modal Opener Loop
      let modalOpened = false;
      for (let attempt = 1; attempt <= 4; attempt++) {
        const isNowOpen = await page.evaluate(() => {
          const modal = Array.from(document.querySelectorAll('.modal-dialog, .modal-content, merch-modal, .modal-body, .modal, merch-select-marketplaces-modal'))
            .find(el => {
              const r = el.getBoundingClientRect();
              return r.height > 0 && r.width > 0;
            });
          if (modal) return true;

          const btn = (document.getElementById('select-marketplace-button-original') 
            || document.querySelector('[id*="select-marketplace"]')
            || document.querySelector('button[aria-label*="Select Products"]')
            || document.querySelector('button.select-marketplaces-button')) as HTMLElement;
          if (btn) {
            btn.click();
            return false;
          }
          return false;
        });

        if (isNowOpen) {
          modalOpened = true;
          break;
        }

        await page.waitForTimeout(1200);

        const checkModal = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.modal-dialog, .modal-content, merch-modal, .modal-body, .modal, merch-select-marketplaces-modal'))
            .some(el => {
              const r = el.getBoundingClientRect();
              return r.height > 0 && r.width > 0;
            });
        });

        if (checkModal) {
          modalOpened = true;
          break;
        }
      }

      if (!modalOpened) {
        this.log(`⚠️ 'Select Products' Button konnte nicht geöffnet werden, fahre mit Standard-Auswahl fort...`);
      } else {
        await page.waitForTimeout(300);

        const catalog = ProductCatalogService.getCatalog();
        const productAmazonKeys: Record<string, string> = {};
        for (const p of catalog.products) {
          productAmazonKeys[p.id] = p.amazon?.key || p.amazon?.checkboxClass || p.id;
        }

        // Perform fast double-check state synchronization inside the modal
        const modalResult = await page.evaluate(async (params: { activeMap: Record<string, string[]>; productAmazonKeys: Record<string, string> }) => {
          const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
          const modal = Array.from(document.querySelectorAll('.modal-content, .modal-dialog, merch-modal, .modal'))
            .find(el => {
              const r = el.getBoundingClientRect();
              return r.height > 0 && r.width > 0;
            });
          if (!modal) return { success: true, modifiedCount: 0 };

          let modifiedCount = 0;
          const products = Object.keys(params.activeMap);

          for (const pid of products) {
            const desiredMarketplaces = new Set(params.activeMap[pid] || []);
            const allMarketplaces = ['US', 'DE', 'GB', 'FR', 'IT', 'ES', 'JP'];
            const targetKey = params.productAmazonKeys[pid] || pid;

            for (const mp of allMarketplaces) {
              let selector = `flowcheckbox[class*="${targetKey}-${mp}"]`;
              let cb = modal.querySelector(selector) as HTMLElement;
              if (!cb && targetKey !== pid) {
                cb = modal.querySelector(`flowcheckbox[class*="${pid}-${mp}"]`) as HTMLElement;
              }
              if (!cb || cb.classList.contains('ng-hide')) continue;

              const shouldBeChecked = desiredMarketplaces.has(mp);
              const icon = cb.querySelector('.sci-icon');
              const isChecked = icon ? icon.classList.contains('sci-check-box') : false;

              if (isChecked !== shouldBeChecked) {
                cb.click();
                modifiedCount++;
                await sleep(5);
              }
            }
          }

          // Search Continue / Submit button across all known Merch selectors
          const candidateSelectors = [
            '.modal-footer .btn-submit',
            '.modal-footer button.btn-primary',
            '.modal-footer button[type="submit"]',
            'button.btn-submit',
            '.modal-footer button.btn-success',
            '.modal-footer button:not(.btn-cancel):not(.btn-default)',
            'button[aria-label*="Continue"]',
            'button[aria-label*="Weiter"]'
          ];

          let continueBtn: HTMLElement | null = null;
          for (const sel of candidateSelectors) {
            continueBtn = (modal.querySelector(sel) || document.querySelector(sel)) as HTMLElement;
            if (continueBtn && continueBtn.offsetParent !== null) break;
          }

          if (!continueBtn) {
            const allButtons = Array.from(modal.querySelectorAll('button'));
            continueBtn = allButtons.find(b => {
              const txt = b.textContent?.trim().toLowerCase() || '';
              return txt.includes('continue') || txt.includes('weiter') || txt.includes('done') || txt.includes('speichern') || txt.includes('save') || txt.includes('submit') || txt.includes('ok');
            }) || null;
          }

          if (continueBtn) {
            continueBtn.click();
            return { success: true, modifiedCount };
          }

          const isModalStillOpen = document.querySelector('.modal-content, .modal-dialog') !== null;
          if (!isModalStillOpen) {
            return { success: true, modifiedCount };
          }

          return { success: false, error: 'Continue button in modal not found' };
        }, { activeMap: item.activeProductsMap, productAmazonKeys });

        if (!modalResult.success) {
          this.log(`⚠️ Modal-Hinweis: ${modalResult.error} (versuche fortzufahren)`);
        }

        // Wait for modal backdrop to hide
        await page.waitForSelector('.modal-backdrop, .modal-dialog', { state: 'hidden', timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);

        this.log(`✅ Marktplatz-Matrix synchronisiert (${modalResult.modifiedCount} Checkboxen angepasst)`, 'Produkte gewählt ✓', 50, 100);
      }

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 6. Sequential Product Details Configuration (Dynamic Catalog Driven with Smooth Scrolling & Delays)
      const catalog = ProductCatalogService.getCatalog();
      const sortedCatalogProducts = [...catalog.products].sort((a, b) => 
        (a.amazonSortOrder ?? a.amazon?.sortOrder ?? a.sortOrder ?? 999) - 
        (b.amazonSortOrder ?? b.amazon?.sortOrder ?? b.sortOrder ?? 999)
      );
      
      // Filter products that have at least 1 active marketplace
      const activeProductsToProcess = sortedCatalogProducts.filter(p => {
        const mps = item.activeProductsMap[p.id];
        return Array.isArray(mps) && mps.length > 0;
      });

      const totalActiveProducts = activeProductsToProcess.length;
      this.log(`👕 Bearbeite ${totalActiveProducts} aktive Produkte sequenziell nach Amazon SortOrder...`, 'Bearbeite Produktdetails...', 52, 100);

      const productUploadResults: ProductUploadResult[] = [];

      // Pre-populate skipped products (not selected, unavailable, tm-blocked)
      for (const p of catalog.products) {
        const mps = item.activeProductsMap[p.id];
        const amazonKey = p.amazon?.key || p.id;
        if (item.tmBlockedProductIds && item.tmBlockedProductIds.map(t => t.toUpperCase()).includes(p.id.toUpperCase())) {
          productUploadResults.push({ productId: p.id, amazonKey, status: 'SKIPPED_TM_BLOCKED', reason: 'Blocked by Trademark V2' });
        } else if (p.available === false) {
          productUploadResults.push({ productId: p.id, amazonKey, status: 'SKIPPED_UNAVAILABLE', reason: 'Product unavailable on Amazon' });
        } else if (!Array.isArray(mps) || mps.length === 0) {
          productUploadResults.push({ productId: p.id, amazonKey, status: 'SKIPPED_NOT_SELECTED', reason: 'No active marketplaces selected' });
        }
      }

      const avoidColor = item.avoidColor || 'none';
      let fitTypes = item.fitTypes || ['men', 'women', 'youth'];
      
      // Rule: If in question phase only 'Youth' is selected, automatically include 'Men' as well
      const normalizedFits = fitTypes.map(f => f.toLowerCase());
      if (normalizedFits.includes('youth') && !normalizedFits.includes('men') && !normalizedFits.includes('women')) {
        fitTypes = [...fitTypes, 'men'];
      }

      // Strikte Validierung von customBackgroundColor (nur echte 6-stellige Hex-Werte wie '#000000', niemals "Automatisch" o.ä.)
      let resolvedBgHex = avoidColor === 'black' ? '#FFFFFF' : '#000000';
      if (item.customBackgroundColor && typeof item.customBackgroundColor === 'string') {
        const trimmed = item.customBackgroundColor.trim().replace(/^#/, '');
        if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
          resolvedBgHex = `#${trimmed.toUpperCase()}`;
        }
      }
      const customBgColor = resolvedBgHex;

      for (let i = 0; i < totalActiveProducts; i++) {
        if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

        const product = activeProductsToProcess[i];
        const stepProgress = 52 + Math.round(((i + 1) / totalActiveProducts) * 28); // 52% to 80%

        this.log(`[${i + 1}/${totalActiveProducts}] Öffne & prüfe "${product.displayName}" (${product.amazon?.key || product.id})...`, `Bearbeite ${product.displayName}`, stepProgress, 100);

        // Säule 3: Robuster "Edit details" Klick- & Öffnungs-Check mit aktiver Verifikation & Retries
        let editorOpened = false;
        let openRetries = 0;
        const maxOpenRetries = 3;
        let lastOpenReason = '';

        while (!editorOpened && openRetries < maxOpenRetries) {
          openRetries++;

          const openResult = await page.evaluate(async (params: { pid: string; amazonKey: string; cardId: string }) => {
            const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
            const { pid, amazonKey, cardId } = params;

            // 1. Locate the exact product card using Amazon cardId and amazonKey
            const allCards = Array.from(document.querySelectorAll('[id*="-card"], [class*="-card"], .card, .product-card')) as HTMLElement[];
            let card = document.getElementById(cardId) 
              || document.getElementById(`${amazonKey}-card`) 
              || document.getElementById(`${amazonKey.toLowerCase()}-card`)
              || document.getElementById(`${pid}-card`)
              || document.getElementById(`${pid.toLowerCase()}-card`)
              || document.getElementById(`config-${amazonKey}`)
              || document.getElementById(`config-${pid}`);

            if (!card) {
              card = allCards.find(c => {
                const idUpper = (c.id || '').toUpperCase();
                const clsUpper = Array.from(c.classList).join(' ').toUpperCase();
                return idUpper.includes(amazonKey) || clsUpper.includes(amazonKey) || idUpper.includes(pid) || clsUpper.includes(pid);
              }) || (document.querySelector(`.${pid}-container`) || document.querySelector(`[id*="${pid}"]`)) as HTMLElement;
            }

            // 2. Locate the "Edit details" button
            let editBtn: HTMLElement | null = null;
            if (card) {
              editBtn = (card.querySelector('.edit-button') 
                || card.querySelector('button.edit-btn') 
                || card.querySelector('.edit-details-btn')
                || card.querySelector('button[class*="edit"]')
                || Array.from(card.querySelectorAll('button')).find(b => b.textContent?.trim().toLowerCase().includes('edit'))) as HTMLElement;
            }

            if (!editBtn) {
              editBtn = (document.querySelector(`.${amazonKey}-edit-btn`) 
                || document.querySelector(`.${amazonKey.toLowerCase()}-edit-btn`) 
                || document.querySelector(`#${amazonKey}-card .edit-button`) 
                || document.querySelector(`#${amazonKey}-card button.edit-btn`)
                || document.querySelector(`button[class*="${amazonKey}-edit"]`)
                || document.querySelector(`[id*="${amazonKey}"] button, [class*="${amazonKey}"] button`)
                || Array.from(document.querySelectorAll(`button`)).find(b => b.textContent?.trim().toLowerCase().includes('edit') && (b.closest(`#${amazonKey}-card`) || (card && b.closest(`#${card.id}`))))) as HTMLElement;
            }

            if (!editBtn) {
              return { success: false, reason: `Edit button für ${pid} (${amazonKey}) nicht im DOM gefunden` };
            }

            // 3. Scroll cleanly to button
            editBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(200);

            // 4. Click button to open editor
            editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            editBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            editBtn.click();

            // 5. Active polling: Wait up to 2500ms until editor is open
            const startWait = Date.now();
            while (Date.now() - startWait < 2500) {
              await sleep(150);
              const allEditors = Array.from(document.querySelectorAll('.product-editor, product-editor, .product-config-panel')) as HTMLElement[];
              const openEditor = allEditors.find(ed => ed.offsetHeight > 40 && ed.innerHTML.length > 20);
              if (openEditor) {
                return { success: true, isAlreadyOpen: false };
              }
            }

            return { success: true, reason: 'proceed_anyway' };
          }, {
            pid: product.id,
            amazonKey: product.amazon?.key || product.id,
            cardId: product.amazon?.cardId || `${product.amazon?.key || product.id}-card`
          });

          if (openResult.success) {
            editorOpened = true;
          } else {
            lastOpenReason = openResult.reason || '';
            this.log(`⚠️ Versuch ${openRetries}/${maxOpenRetries} für "${product.displayName}": ${openResult.reason} - wiederhole...`);
            await page.waitForTimeout(400);
          }
        }

        if (!editorOpened) {
          this.log(`❌ Konnte Editor für "${product.displayName}" nach ${maxOpenRetries} Versuchen nicht öffnen!`);
          productUploadResults.push({
            productId: product.id,
            amazonKey: product.amazon?.key || product.id,
            status: 'FAILED_EDITOR_OPEN',
            reason: `Editor für ${product.displayName} konnte nicht geöffnet werden: ${lastOpenReason}`
          });
          continue;
        }

        if (product.colorDiscoveryStatus === 'FAILED') {
          this.log(`❌ Farbentdeckung für "${product.displayName}" war fehlgeschlagen (colorDiscoveryStatus = FAILED)!`);
          productUploadResults.push({
            productId: product.id,
            amazonKey: product.amazon?.key || product.id,
            status: 'FAILED_COLOR_CONFIGURATION',
            reason: `Farbentdeckung für ${product.displayName} im Produktkatalog ist unvollständig (colorDiscoveryStatus = FAILED)`
          });
          continue;
        }

        const editResult = await page.evaluate(async (params: {
          productId: string;
          amazonKey: string;
          cardId: string;
          colorMode: string;
          fitTypes: string[];
          avoidColor: string;
          customBgColor: string;
          catalogColors: Array<{ id: string; avoidRule?: 'none' | 'white' | 'black' }>;
        }) => {
          const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
          const { productId: pid, amazonKey, cardId } = params;

          // 1. Locate the exact product card using Amazon cardId and amazonKey
          let card: HTMLElement | null = document.getElementById(cardId) 
            || document.getElementById(`${amazonKey}-card`) 
            || document.getElementById(`${amazonKey.toLowerCase()}-card`)
            || document.getElementById(`${pid}-card`)
            || document.getElementById(`${pid.toLowerCase()}-card`)
            || document.getElementById(`config-${amazonKey}`)
            || document.getElementById(`config-${pid}`);

          if (!card) {
            const allCards = Array.from(document.querySelectorAll('[id*="-card"], [class*="-card"], .card, .product-card')) as HTMLElement[];
            card = allCards.find(c => {
              const idUpper = (c.id || '').toUpperCase();
              const clsUpper = Array.from(c.classList).join(' ').toUpperCase();
              return idUpper.includes(amazonKey) || clsUpper.includes(amazonKey) || idUpper.includes(pid) || clsUpper.includes(pid);
            }) || (document.querySelector(`.${pid}-container`) || document.querySelector(`[id*="${pid}"]`)) as HTMLElement;
          }

          const allEditors = Array.from(document.querySelectorAll('.product-editor, product-editor, .product-config-panel')) as HTMLElement[];
          let inputContainer: HTMLElement = (card || (allEditors[allEditors.length - 1] as HTMLElement) || document.body) as HTMLElement;
          if (card) {
            const cardRect = card.getBoundingClientRect();
            const validEditors = allEditors.filter(ed => {
              const edRect = ed.getBoundingClientRect();
              return edRect.top >= cardRect.bottom - 100 && ed.innerHTML.length > 20;
            });
            if (validEditors.length > 0) {
              inputContainer = validEditors[0];
            }
          }

          // Helper 1: isElementChecked
          const isElementChecked = (el: Element): boolean => {
            const icon = el.querySelector('.sci-icon, i, svg');
            if (icon) {
              const iconClass = (icon.className || '').toLowerCase();
              if (iconClass.includes('blank')) return false;
              if (iconClass.includes('sci-check-box') || iconClass.includes('sci-check') || iconClass.includes('checkmark')) return true;
            }
            const input = el.querySelector('input[type="checkbox"], input') as HTMLInputElement;
            if (input && typeof input.checked === 'boolean') return input.checked;
            if (el instanceof HTMLInputElement && typeof el.checked === 'boolean') return el.checked;

            const aria = el.getAttribute('aria-checked');
            if (aria === 'true') return true;
            if (aria === 'false') return false;

            return el.classList.contains('checked') || el.classList.contains('selected') || el.classList.contains('active');
          };

          // Helper 2: clickTargetElement (Single target click - strictly avoids double-toggling)
          const clickTargetElement = (el: Element) => {
            const input = el.querySelector('input') as HTMLInputElement;
            if (input && (input.disabled || input.readOnly)) return;

            const target = (el.querySelector('span.color-checkbox') || el.querySelector('span') || el) as HTMLElement;
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            target.click();
          };

          // Helper 3: Clue gathering
          const extractColorClues = (cb: Element): string => {
            const clues: string[] = [];
            if (cb.className) clues.push(String(cb.className));
            ['name', 'id', 'aria-label', 'title', 'data-color', 'data-name'].forEach(attr => {
              const val = cb.getAttribute(attr);
              if (val) clues.push(String(val));
            });
            cb.querySelectorAll('*').forEach(el => {
              if (el.className) clues.push(String(el.className));
              if (el.getAttribute('title')) clues.push(String(el.getAttribute('title')));
              if (el.getAttribute('aria-label')) clues.push(String(el.getAttribute('aria-label')));
              if (el.getAttribute('name')) clues.push(String(el.getAttribute('name')));
              if (el.getAttribute('id')) clues.push(String(el.getAttribute('id')));
            });
            if (cb.textContent) clues.push(cb.textContent.trim());
            return clues.join(' ').toLowerCase();
          };

          const extractDomColorId = (cb: Element): string => {
            const m1 = (cb.className || '').match(/([a-z0-9_]+)-checkbox/i);
            const innerSpan = cb.querySelector('span.color-checkbox, span[class*="checkbox-"]');
            const m2 = innerSpan ? (innerSpan.className || '').match(/checkbox-([a-z0-9_]+)/i) : null;
            return (m1 ? m1[1] : (m2 ? m2[1] : '')).toLowerCase();
          };

          // -------------------------------------------------------------
          // STEP A: Fit Types Configuration
          // -------------------------------------------------------------
          let desiredFits = params.fitTypes.map(f => f.toLowerCase());
          if (desiredFits.includes('youth') && !desiredFits.includes('men') && !desiredFits.includes('women')) {
            desiredFits.push('men');
          }
          if (desiredFits.includes('youth') && !desiredFits.includes('girls')) {
            desiredFits.push('girls');
          }
          // Rule: Adult Unisex is always active for any product offering it
          desiredFits.push('adult_unisex', 'unisex', 'adult');

          const visibleFitCandidates = Array.from(document.querySelectorAll(
            '.fit-type-container label, .fit-type-container flowcheckbox, ' +
            'flowcheckbox.men-checkbox, flowcheckbox.women-checkbox, flowcheckbox.youth-checkbox, flowcheckbox.girls-checkbox, flowcheckbox.unisex-checkbox, ' +
            'label.men-label, label.women-label, label.youth-label, label.girls-label, label.unisex-label, ' +
            'flowcheckbox[class*="-checkbox"], label[class*="-label"]'
          )).filter(el => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            return rect.height > 0 && rect.width > 0;
          });

          const fitElements: { element: Element; matchedFit: string }[] = [];
          const seenFits = new Set<string>();

          for (const el of visibleFitCandidates) {
            const parentLabel = (el.closest('label') || el) as HTMLElement;
            const flow = (parentLabel.querySelector('flowcheckbox') || el.closest('flowcheckbox') || el) as HTMLElement;
            const cls = `${(flow.className || '')} ${(parentLabel.className || '')} ${(el.className || '')}`.toLowerCase();
            const text = (parentLabel.textContent || el.textContent || '').trim().toLowerCase();
            const formControl = (flow.getAttribute('formcontrolname') || el.getAttribute('formcontrolname') || '').toLowerCase();
            const combo = `${cls} ${text} ${formControl}`;

            // Ignore header
            if (text === 'choose fit types:' || text.includes('choose fit types')) continue;

            let matchedFit = '';
            if (cls.includes('girls') || text.includes('girls') || combo.includes('girls') || combo.includes('mädchen')) {
              matchedFit = 'girls';
            } else if (cls.includes('youth') || text.includes('youth') || combo.includes('youth') || combo.includes('kinder') || combo.includes('kids')) {
              matchedFit = 'youth';
            } else if (cls.includes('unisex') || text.includes('unisex') || combo.includes('unisex') || combo.includes('adult')) {
              matchedFit = 'adult_unisex';
            } else if (cls.includes('women') || text.includes('women') || combo.includes('women') || combo.includes('frauen') || combo.includes('damen')) {
              matchedFit = 'women';
            } else if (cls.includes('men') || /\bmen\b/.test(text) || combo.includes('männer') || combo.includes('herren')) {
              matchedFit = 'men';
            }

            if (matchedFit && !seenFits.has(matchedFit)) {
              seenFits.add(matchedFit);
              fitElements.push({ element: flow, matchedFit });
            }
          }

          // Apply target selection status
          const activeFitsApplied: string[] = [];
          const fitDebugSummary: Record<string, { target: boolean; final: boolean }> = {};

          for (const item of fitElements) {
            const shouldBeChecked = desiredFits.includes(item.matchedFit) || item.matchedFit === 'adult_unisex' || item.matchedFit === 'unisex';
            let isChecked = isElementChecked(item.element);

            if (isChecked !== shouldBeChecked) {
              clickTargetElement(item.element);
              await sleep(120);
              isChecked = isElementChecked(item.element);

              if (isChecked !== shouldBeChecked) {
                const input = item.element.querySelector('input[type="checkbox"], input') as HTMLInputElement;
                if (input) {
                  input.click();
                  await sleep(120);
                  isChecked = isElementChecked(item.element);
                }
              }
            }

            fitDebugSummary[item.matchedFit] = { target: shouldBeChecked, final: isChecked };
            if (isChecked) {
              activeFitsApplied.push(item.matchedFit);
            }
          }

          // -------------------------------------------------------------
          // STEP B: Color Selection (Custom Picker vs Swatches)
          // -------------------------------------------------------------
          let finalActiveColorNames: string[] = [];
          let selfHealedColor = '';

          if (params.colorMode === 'none') {
            return {
              success: true,
              activeColors: ['Keine Farbkonfiguration erforderlich'],
              fitTypesApplied: activeFitsApplied,
              fitDebug: fitDebugSummary,
              selfHealedColor: '',
              isLocked: false
            };
          } else if (params.colorMode === 'customPicker') {
            // Prüfen ob Farbauswahl für das Produkt gesperrt ist (.locked-container)
            const lockedContainer = (inputContainer?.querySelector('.locked-container, [class*="locked-container"]')
              || card?.querySelector('.locked-container, [class*="locked-container"]')) as HTMLElement;

            const isLocked = Boolean(lockedContainer || inputContainer?.innerText?.toLowerCase().includes('locked on published products'));

            if (isLocked) {
              return { 
                success: true, 
                activeColors: ['Farbe gesperrt (bereits live)'],
                fitTypesApplied: activeFitsApplied,
                fitDebug: fitDebugSummary,
                selfHealedColor: '',
                isLocked: true
              };
            }

            // Hex color picker mode
            let cleanHex = (params.customBgColor || '000000').replace(/^#/, '').toUpperCase();
            if (!/^[0-9A-F]{6}$/.test(cleanHex)) {
              cleanHex = params.avoidColor === 'black' ? 'FFFFFF' : '000000';
            }

            const colorBtn = (inputContainer?.querySelector('#color-btn, button[id*="color-btn"], .background-color-picker-button, button.color-btn, .color-picker-button') 
              || document.querySelector('#color-btn, button[id*="color-btn"]')) as HTMLElement;

            if (colorBtn) {
              const isPopoverOpen = colorBtn.hasAttribute('aria-describedby');
              if (!isPopoverOpen) {
                colorBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                colorBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                colorBtn.click();
                await sleep(500);
              }

              const popoverId = colorBtn.getAttribute('aria-describedby');
              const popover = (popoverId ? document.getElementById(popoverId) : null)
                || document.querySelector('ngb-popover-window, color-sketch, .color-picker-popover, .sketch-picker') as HTMLElement;

              if (popover) {
                // 1. Check palette swatches
                const swatches = Array.from(popover.querySelectorAll('.sketch-swatches div, .sketch-swatches span, .sketch-swatches [title], .sketch-swatches [style]')) as HTMLElement[];
                let matchedSwatch: HTMLElement | null = null;
                for (const sw of swatches) {
                  const title = (sw.getAttribute('title') || '').replace(/^#/, '').toUpperCase();
                  const style = (sw.getAttribute('style') || '').toLowerCase();
                  if (title === cleanHex) {
                    matchedSwatch = sw;
                    break;
                  }
                  if (cleanHex === '000000' && (style.includes('rgb(0, 0, 0)') || style.includes('#000000') || title === '000000')) {
                    matchedSwatch = sw;
                    break;
                  }
                  if (cleanHex === 'FFFFFF' && (style.includes('rgb(255, 255, 255)') || style.includes('#ffffff') || title === 'FFFFFF')) {
                    matchedSwatch = sw;
                    break;
                  }
                }

                if (matchedSwatch) {
                  matchedSwatch.click();
                  await sleep(150);
                }

                // 2. Locate hex input (Listing Optimizer Zeilen 3176-3186)
                let hexInput = popover.querySelector('color-editable-input[label="hex"] input') as HTMLInputElement;
                if (!hexInput) {
                  const spans = Array.from(popover.querySelectorAll('span'));
                  const hexSpan = spans.find(span => span.textContent?.trim().toLowerCase() === 'hex');
                  if (hexSpan) {
                    hexInput = (hexSpan.closest('.wrap')?.querySelector('input') || hexSpan.parentElement?.querySelector('input')) as HTMLInputElement;
                  }
                }
                if (!hexInput) {
                  hexInput = (popover.querySelector('input[type="text"]') || popover.querySelector('input')) as HTMLInputElement;
                }

                if (hexInput) {
                  hexInput.focus();
                  hexInput.value = '';
                  hexInput.dispatchEvent(new Event('input', { bubbles: true }));

                  for (let i = 0; i < cleanHex.length; i++) {
                    const char = cleanHex[i];
                    hexInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
                    hexInput.value = cleanHex.slice(0, i + 1);
                    hexInput.dispatchEvent(new Event('input', { bubbles: true }));
                    hexInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
                    await sleep(25);
                  }
                  hexInput.dispatchEvent(new Event('change', { bubbles: true }));
                  hexInput.blur();
                  await sleep(200);
                }

                // Close popover if still open (Listing Optimizer Zeilen 3195-3198)
                if (colorBtn.hasAttribute('aria-describedby')) {
                  colorBtn.click();
                  await sleep(200);
                }

                finalActiveColorNames.push(`#${cleanHex}`);
              }
            } else {
              // Direct hex input fallback (Listing Optimizer Zeilen 3200-3206)
              const directHex = (inputContainer?.querySelector('input[type="text"][id*="hex"], input[type="text"][placeholder*="Hex"]')
                || document.querySelector('input[type="text"][id*="hex"]')) as HTMLInputElement;
              if (directHex) {
                directHex.value = cleanHex;
                directHex.dispatchEvent(new Event('input', { bubbles: true }));
                directHex.dispatchEvent(new Event('change', { bubbles: true }));
                finalActiveColorNames.push(`#${cleanHex}`);
              }
            }
          } else {
            // Swatches Mode (Predefined Colors) - only visible swatches in open editor
            const colorCheckboxes = Array.from(document.querySelectorAll('colorcheckbox, .color-checkbox, flowcheckbox[class*="color"]'))
              .filter(el => {
                const rect = (el as HTMLElement).getBoundingClientRect();
                return rect.height > 0 && rect.width > 0;
              });

            // PASS 1: Apply user's Product Catalog definitions exclusively (Single Source of Truth)
            for (const cb of colorCheckboxes) {
              const domColorId = extractDomColorId(cb);
              const haystack = extractColorClues(cb);

              // 1. Find matching color definition from product catalog
              let matchedConfig: { id: string; avoidRule?: 'none' | 'white' | 'black' } | undefined;

              if (params.catalogColors && params.catalogColors.length > 0) {
                matchedConfig = params.catalogColors.find((c: any) => 
                  (domColorId && c.id === domColorId) || 
                  haystack.includes(c.id) ||
                  (domColorId && c.id.includes(domColorId))
                );
              }

              // 2. Strict decision based solely on Product Catalog
              let shouldBeChecked = false;

              if (matchedConfig) {
                const rule = matchedConfig.avoidRule || 'none';
                if (params.avoidColor === 'white' && rule === 'white') {
                  shouldBeChecked = false;
                } else if (params.avoidColor === 'black' && rule === 'black') {
                  shouldBeChecked = false;
                } else {
                  shouldBeChecked = true;
                }
              } else {
                // Color not in catalog for this product -> do not select
                shouldBeChecked = false;
              }

              const isChecked = isElementChecked(cb);

              if (isChecked !== shouldBeChecked) {
                clickTargetElement(cb);
                await sleep(75);
              }
            }

            // PASS 2: DOM AUDIT & DOUBLE-CHECK (Zähle tatsächlich angewählte Farben)
            await sleep(100);
            let activeSwatches = colorCheckboxes.filter(cb => isElementChecked(cb));

            // PASS 3: STRICT AUDIT - KEIN LEGACY FALLBACK
            if (activeSwatches.length === 0 && colorCheckboxes.length > 0) {
              return {
                success: false,
                error: `FAILED_COLOR_CONFIGURATION: Keine Farben aktiv nach avoidRules (${params.avoidColor})`,
                activeColors: [],
                fitTypesApplied: activeFitsApplied,
                fitDebug: fitDebugSummary,
                selfHealedColor: '',
                isLocked: false
              };
            }

            // PASS 4: Finale Namen der aktivierten Farben für das Live-Log auslesen
            finalActiveColorNames = activeSwatches.map(cb => {
              const domId = extractDomColorId(cb);
              if (domId) return domId;
              const h = extractColorClues(cb);
              const matched = (params.catalogColors || []).find((c: any) => h.includes(c.id));
              if (matched) return matched.id;
              return cb.getAttribute('name') || cb.getAttribute('title') || 'Color';
            });
          }

          return { 
            success: true, 
            activeColors: finalActiveColorNames,
            fitTypesApplied: activeFitsApplied,
            fitDebug: fitDebugSummary,
            selfHealedColor,
            isLocked: false
          };
        }, {
          productId: product.id,
          amazonKey: product.amazon?.key || product.id,
          cardId: product.amazon?.cardId || `${product.amazon?.key || product.id}-card`,
          colorMode: product.colorMode,
          fitTypes,
          avoidColor: String(avoidColor).toLowerCase(),
          customBgColor,
          catalogColors: Array.isArray(product.colors) ? product.colors.map(c => ({ id: c.id.toLowerCase(), avoidRule: c.avoidRule || 'none' })) : []
        });

        let currentProductStatus: ProductUploadStatus = 'SUCCESS';
        let currentProductFailureReason: string | undefined;

        if (editResult.success) {
          const colorsList = editResult.activeColors && editResult.activeColors.length > 0 ? editResult.activeColors.join(', ') : 'OK';
          const fitsList = editResult.fitTypesApplied && editResult.fitTypesApplied.length > 0 ? editResult.fitTypesApplied.join(', ') : 'Standard';
          const fitDetails = editResult.fitDebug && Object.keys(editResult.fitDebug).length > 0 
            ? ` [Fits: ${Object.entries(editResult.fitDebug).map(([k, v]) => `${k}:${v.final ? '✓' : '✗'}`).join(' ')}]` 
            : '';

          if (editResult.isLocked) {
            this.log(`ℹ️ ${product.displayName}: Farbe & Artwork auf Amazon gesperrt (bereits live) ✓ | Fit: ${fitsList}${fitDetails}`);
          } else {
            this.log(`✓ ${product.displayName}: ${editResult.activeColors?.length || 1} Farben (${colorsList}) | Fit: ${fitsList}${fitDetails}`);
          }
        } else {
          if (editResult.error?.includes('FAILED_FIT_TYPE')) {
            currentProductStatus = 'FAILED_FIT_TYPE';
          } else if (editResult.error?.includes('FAILED_COLOR_CONFIGURATION')) {
            currentProductStatus = 'FAILED_COLOR_CONFIGURATION';
          } else {
            currentProductStatus = 'FAILED_UNKNOWN';
          }
          currentProductFailureReason = editResult.error;
          this.log(`❌ Konfigurationsfehler bei ${product.displayName}: ${editResult.error}`);
        }

        // Dynamic Artwork Replacement via ProductArtworkConfig
        const artworkConfig = product.artwork;
        const strategy = artworkConfig?.selectionStrategy || 'DEFAULT_MASTER';

        if (strategy !== 'DEFAULT_MASTER' && artworkConfig?.variants && artworkConfig.variants.length > 0) {
          let selectedVariant = artworkConfig.variants[0];
          const isAvoidWhite = String(avoidColor || '').trim().toLowerCase() === 'white';

          if (strategy === 'VISION_AVOID_WHITE') {
            if (isAvoidWhite) {
              const brushVariant = artworkConfig.variants.find(v => v.id.includes('BRUSH'));
              if (brushVariant) selectedVariant = brushVariant;
            } else {
              const standardVariant = artworkConfig.variants.find(v => v.id.includes('STANDARD'));
              if (standardVariant) selectedVariant = standardVariant;
            }
          } else if (strategy === 'ALWAYS_STANDARD') {
            const standardVariant = artworkConfig.variants.find(v => v.id.includes('STANDARD'));
            if (standardVariant) selectedVariant = standardVariant;
          }

          const cleanTaskId = item.taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const designsDir = path.resolve(process.cwd(), 'data', 'designs');
          
          let targetArtworkPath = item.resizedAssets?.[selectedVariant.artifactKey as keyof typeof item.resizedAssets];
          if (!targetArtworkPath) {
            const expectedFilename = `${cleanTaskId}_${selectedVariant.id.toLowerCase()}.png`;
            const candidatePath = path.join(designsDir, expectedFilename);
            if (fs.existsSync(candidatePath)) targetArtworkPath = candidatePath;
          }

          // On-the-fly Resize Fallback wenn Resized Asset noch nicht auf Disk existiert
          if (!targetArtworkPath || !fs.existsSync(targetArtworkPath)) {
            if (pngAbsolutePath && fs.existsSync(pngAbsolutePath)) {
              try {
                this.log(`📐 Generiere Two-Sided Resized Varianten für Task ${item.taskId} on-the-fly...`);
                const resizeResult = await ArtworkResizeService.generateResizedArtworks(cleanTaskId, pngAbsolutePath);
                targetArtworkPath = resizeResult[selectedVariant.artifactKey as keyof typeof resizeResult];
              } catch (e: any) {
                this.log(`⚠️ On-the-fly Resize fehlgeschlagen für ${product.displayName}: ${e.message}`);
              }
            }
          }

          if (targetArtworkPath && fs.existsSync(targetArtworkPath)) {
            const isBrushApplied = selectedVariant.id.includes('BRUSH');
            this.log(`🎨 Ersetze Artwork für ${product.displayName} mit ${selectedVariant.id} (${isBrushApplied ? 'Black Brush weil avoid white' : 'Two-Sided Standard'})...`);
            
            // 1. Altes Artwork löschen falls delete-button vorhanden
            const deleteResult = await page.evaluate(async (params: { pid: string; amazonKey: string; cardId: string }) => {
              const { pid, amazonKey, cardId } = params;

              // 1. Locate product card
              let card: HTMLElement | null = document.getElementById(cardId) 
                || document.getElementById(`${amazonKey}-card`) 
                || document.getElementById(`${amazonKey.toLowerCase()}-card`) 
                || document.getElementById(`${pid}-card`) 
                || document.getElementById(`${pid.toLowerCase()}-card`);

              if (!card) {
                const allCards = Array.from(document.querySelectorAll('[id*="-card"], [class*="-card"], .card, .product-card')) as HTMLElement[];
                card = allCards.find(c => {
                  const idUpper = (c.id || '').toUpperCase();
                  const clsUpper = Array.from(c.classList).join(' ').toUpperCase();
                  return idUpper.includes(amazonKey) || clsUpper.includes(amazonKey) || idUpper.includes(pid);
                }) || null;
              }

              const allEditors = Array.from(document.querySelectorAll('.product-editor, product-editor, .product-config-panel')) as HTMLElement[];
              let inputContainer: HTMLElement | null = card;
              if (card) {
                const cardRect = card.getBoundingClientRect();
                const validEditors = allEditors.filter(ed => {
                  const edRect = ed.getBoundingClientRect();
                  return edRect.top >= cardRect.bottom - 100 && ed.innerHTML.length > 20;
                });
                if (validEditors.length > 0) {
                  inputContainer = validEditors[0];
                } else if (allEditors.length > 0) {
                  inputContainer = allEditors[allEditors.length - 1];
                }
              } else if (allEditors.length > 0) {
                inputContainer = allEditors[allEditors.length - 1];
              }

              let clickedDelete = false;
              let deleteButton = (card?.querySelector('.delete-button, .sci-icon.sci-delete-forever')
                || inputContainer?.querySelector('.delete-button, .sci-icon.sci-delete-forever')
                || document.querySelector(`#${amazonKey}-card .delete-button`)
                || document.querySelector(`#${amazonKey.toLowerCase()}-card .delete-button`)
                || document.querySelector(`#${pid}-card .delete-button`)) as HTMLElement;

              if (deleteButton) {
                deleteButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                deleteButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                deleteButton.click();
                clickedDelete = true;
              }

              return { clickedDelete };
            }, {
              pid: product.id,
              amazonKey: product.amazon?.key || product.id,
              cardId: product.amazon?.cardId || `${product.amazon?.key || product.id}-card`
            });

            if (deleteResult.clickedDelete) {
              this.log(`⏳ ${product.displayName}: Altes Artwork gelöscht, warte auf Bereitstellung des Dropzone-Felds...`);
              await page.waitForTimeout(800);
            }

            // 2. File-Input mit aktivem Polling lokalisieren
            const locateInputResult = await page.evaluate(async (params: { pid: string; amazonKey: string }) => {
              const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
              const { pid, amazonKey } = params;

              let foundInput: HTMLInputElement | null = null;
              let retries = 0;

              while (!foundInput && retries < 15) {
                let uploadLabel = (document.querySelector(`label.file-upload-input[for="${amazonKey}-DESIGN-wizzy"]`)
                  || document.querySelector(`label.file-upload-input[for="${amazonKey.toLowerCase()}-DESIGN-wizzy"]`)
                  || document.querySelector(`label.file-upload-input[for="${pid}-DESIGN-wizzy"]`)
                  || document.querySelector(`label.file-upload-input[for*="${amazonKey}"]`)
                  || document.querySelector('.product-editor label.file-upload-input')
                  || document.querySelector('label.file-upload-input')
                  || document.querySelector('label[for*="DESIGN"]')) as HTMLElement;

                if (uploadLabel) {
                  const forAttr = uploadLabel.getAttribute('for');
                  if (forAttr) {
                    const el = document.getElementById(forAttr);
                    if (el instanceof HTMLInputElement && el.type === 'file') {
                      foundInput = el;
                    } else if (el) {
                      foundInput = el.querySelector('input[type="file"]') as HTMLInputElement;
                    }
                  }
                }

                if (!foundInput) {
                  const directInput = (document.getElementById(`${amazonKey}-DESIGN-wizzy`)
                    || document.getElementById(`${amazonKey.toLowerCase()}-DESIGN-wizzy`)
                    || document.getElementById(`${pid}-DESIGN-wizzy`)
                    || document.querySelector(`#${amazonKey}-card input[type="file"]`)
                    || document.querySelector(`#${amazonKey.toLowerCase()}-card input[type="file"]`)
                    || document.querySelector(`#${pid}-card input[type="file"]`)
                    || document.querySelector('.product-editor input[type="file"]')
                    || document.querySelector('.dropzone-container input[type="file"]')) as HTMLInputElement;
                  if (directInput && directInput.tagName === 'INPUT' && directInput.type === 'file') {
                    foundInput = directInput;
                    break;
                  }
                }

                if (!foundInput) {
                  await sleep(200);
                  retries++;
                }
              }

              if (foundInput) {
                const uniqueId = `mba-upload-input-${pid.toLowerCase()}-${Date.now()}`;
                foundInput.id = uniqueId;
                return { success: true, inputId: uniqueId };
              }

              return { success: false, inputId: '' };
            }, {
              pid: product.id,
              amazonKey: product.amazon?.key || product.id
            });

            let finalInputLocator = locateInputResult.inputId ? page.locator(`#${locateInputResult.inputId}`) : null;

            if (!finalInputLocator || (await finalInputLocator.count()) === 0) {
              const amazonKey = product.amazon?.key || product.id;
              const fallbackSelector = `#${amazonKey}-card input[type="file"], #${amazonKey.toLowerCase()}-card input[type="file"], #${product.id}-card input[type="file"], .product-editor input[type="file"], .dropzone-container input[type="file"], input[type="file"].file-upload-input`;
              const fb = page.locator(fallbackSelector).first();
              if ((await fb.count()) > 0) {
                finalInputLocator = fb;
              }
            }

            if (finalInputLocator && (await finalInputLocator.count()) > 0) {
              try {
                await finalInputLocator.setInputFiles(targetArtworkPath);

                if (locateInputResult.inputId) {
                  await page.evaluate((id: string) => {
                    const el = document.getElementById(id);
                    if (el) {
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }, locateInputResult.inputId);
                }

                this.log(`⏳ ${product.displayName}: Artwork zugewiesen (${path.basename(targetArtworkPath)}). Warte auf Upload-Abschluss...`);

                let uploadDone = false;
                const pollStart = Date.now();
                const amazonKey = product.amazon?.key || product.id;
                while (Date.now() - pollStart < 10000) {
                  await page.waitForTimeout(500);
                  const isFinished = await page.evaluate((ak: string) => {
                    const card = document.getElementById(`${ak.toLowerCase()}-card`) 
                      || document.getElementById(`${ak.toUpperCase()}-card`)
                      || document.getElementById(`config-${ak.toLowerCase()}`)
                      || document.getElementById(`config-${ak.toUpperCase()}`);
                    const delOnCard = card?.querySelector('.delete-button, .sci-icon.sci-delete-forever') as HTMLElement;
                    if (delOnCard && (delOnCard.offsetParent !== null || delOnCard.getBoundingClientRect().width > 0)) {
                      return true;
                    }

                    const allEditors = Array.from(document.querySelectorAll('.product-editor, product-editor, .product-config-panel')) as HTMLElement[];
                    const container = allEditors[allEditors.length - 1];
                    const delBtn = container?.querySelector('.delete-button, .sci-icon.sci-delete-forever') as HTMLElement;
                    if (delBtn && (delBtn.offsetParent !== null || delBtn.getBoundingClientRect().width > 0)) {
                      return true;
                    }

                    const hasProgress = Boolean(document.querySelector('.upload-progress, .progress-bar, flowprogressbar, .loading-spinner'));
                    if (!hasProgress && (container?.querySelector('.asset img, img[class*="design"], canvas.design-canvas') !== null)) {
                      return true;
                    }

                    return false;
                  }, amazonKey);

                  if (isFinished) {
                    uploadDone = true;
                    break;
                  }
                }

                if (uploadDone) {
                  await page.waitForTimeout(500);
                  this.log(`✓ ${product.displayName}: Artwork erfolgreich hochgeladen & bestätigt ✓`);
                } else {
                  this.log(`ℹ️ ${product.displayName}: Upload angestoßen, fahre fort...`);
                }
              } catch (upErr: any) {
                this.log(`❌ Fehler beim Hochladen des Resized Artworks für ${product.displayName}: ${upErr.message}`);
                currentProductStatus = 'FAILED_ARTWORK_UPLOAD';
                currentProductFailureReason = `Artwork-Upload-Fehler: ${upErr.message}`;
              }
            } else {
              this.log(`❌ ${product.displayName}: Kein Upload-Feld im DOM gefunden für ${selectedVariant.id}!`);
              currentProductStatus = 'FAILED_ARTWORK_UPLOAD';
              currentProductFailureReason = `Kein File-Upload-Feld im DOM für ${product.displayName} gefunden`;
            }
          } else {
            this.log(`❌ Special Artwork für ${product.displayName} (${selectedVariant.id}) nicht gefunden: ${targetArtworkPath}`);
            currentProductStatus = 'FAILED_ARTWORK_UPLOAD';
            currentProductFailureReason = `Special Artwork Datei nicht gefunden: ${targetArtworkPath}`;
          }
        }

        // Ergebnis dieses Produkts festhalten
        productUploadResults.push({
          productId: product.id,
          amazonKey: product.amazon?.key || product.id,
          status: currentProductStatus,
          reason: currentProductFailureReason
        });

        await page.waitForTimeout(300);
      }

      this.log(`✅ Alle ${totalActiveProducts} Produkte erfolgreich konfiguriert & verifiziert!`, 'Produktdetails fertig ✓', 80, 100);

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      const rawListings = item.listings || {
        en: { brand: item.brand, title: item.title, bullet1: item.bullet1, bullet2: item.bullet2, description: item.description }
      };

      const hasLocalizedListings = Boolean(
        rawListings && (rawListings.de || rawListings.fr || rawListings.es || rawListings.it || rawListings.ja || rawListings.jp)
      );

      // 7. Auto-Translate Toggle
      if (hasLocalizedListings) {
        this.log(`🌍 Deaktiviere Amazon Auto-Übersetzung (Eigene mehrsprachige Listings vorhanden)...`, 'Setze Übersetzung auf NO...', 82, 100);
        await page.evaluate(async () => {
          const autoTranslateRadioNo = document.getElementById('translation-request-no') as HTMLInputElement;
          if (autoTranslateRadioNo && !autoTranslateRadioNo.checked) {
            autoTranslateRadioNo.click();
          }
        });
      } else {
        this.log(`🌍 Aktiviere Amazon Auto-Übersetzung (Reines englisches Master-Listing)...`, 'Setze Übersetzung auf YES...', 82, 100);
        await page.evaluate(async () => {
          const autoTranslateRadioYes = document.getElementById('translation-request-yes') as HTMLInputElement;
          if (autoTranslateRadioYes && !autoTranslateRadioYes.checked) {
            autoTranslateRadioYes.click();
          }
        });
      }
      await page.waitForTimeout(1000);

      // 8. Listings Injection (with Length Clamping & Angular Events)
      this.log(`📝 Trage ${hasLocalizedListings ? 'mehrsprachige' : 'englisches'} SEO-Listing ein (inkl. Zeichen-Bereinigung)...`, 'Befülle Listings...', 85, 100);

      // Sanitize all listings on server first
      const sanitizedListings: Record<string, any> = {};
      for (const [loc, content] of Object.entries(rawListings)) {
        if (!content) continue;
        sanitizedListings[loc] = {
          brand: UploadWorkerService.sanitizeListingText(content.brand || '', loc),
          title: UploadWorkerService.sanitizeListingText(content.title || '', loc),
          bullet1: UploadWorkerService.sanitizeListingText(content.bullet1 || (content as any).bullet_1 || '', loc),
          bullet2: UploadWorkerService.sanitizeListingText(content.bullet2 || (content as any).bullet_2 || '', loc),
          description: UploadWorkerService.sanitizeListingText(content.description || '', loc),
        };
      }

      const fillResult = await page.evaluate(async ({ listingMap, hasTranslations }: { listingMap: Record<string, any>; hasTranslations: boolean }) => {
        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
        const locales = hasTranslations ? ['en', 'de', 'fr', 'it', 'es', 'ja'] : ['en'];
        const filledLocales: string[] = [];

        // Scroll to listings section
        const listingSection = document.getElementById(hasTranslations ? 'translation-request-no' : 'translation-request-yes') || document.querySelector('product-editor-listing') || document.getElementById('designCreator-productEditor-title');
        if (listingSection) {
          listingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(300);
        }

        for (const loc of locales) {
          const content = listingMap[loc] || (loc === 'ja' ? listingMap['jp'] : null) || listingMap['en'];
          if (!content) continue;

          // Expand locale tab if present
          const tabBtn = document.querySelector(`button[aria-controls="${loc}"], #${loc}-header button, [id="${loc}-header"] button`) as HTMLElement;
          if (tabBtn) {
            tabBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (tabBtn.getAttribute('aria-expanded') !== 'true') {
              tabBtn.click();
              await sleep(350);
            }
          }

          const setVal = (fieldKey: string, rawVal: string, maxLen = 2000) => {
            if (!rawVal) return;
            // Clean quotes and special chars inside browser as well
            let val = rawVal
              .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u275D\u275E]/g, '"')
              .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u275B\u275C]/g, "'")
              .replace(/[\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
              .replace(/\u2026/g, '...')
              .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
              .replace(/\s+/g, ' ');

            const clamped = val.substring(0, maxLen).trim();
            const selectors = loc === 'en' ? [
              `#en #designCreator-productEditor-${fieldKey}`,
              `[id="en"] #designCreator-productEditor-${fieldKey}`,
              `#designCreator-productEditor-${fieldKey}`
            ] : [
              `#${loc} #designCreator-productEditor-${fieldKey}`,
              `[id="${loc}"] #designCreator-productEditor-${fieldKey}`
            ];

            let input: HTMLInputElement | HTMLTextAreaElement | null = null;
            for (const sel of selectors) {
              input = document.querySelector(sel);
              if (input) break;
            }

            if (input) {
              input.focus();
              input.value = clamped;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
            }
          };

          setVal('brandName', content.brand || '', 50);
          setVal('title', content.title || '', 60);
          setVal('featureBullet1', content.bullet1 || content.bullet_1 || '', 256);
          setVal('featureBullet2', content.bullet2 || content.bullet_2 || '', 256);
          setVal('description', content.description || '', 2000);

          filledLocales.push(loc.toUpperCase());
          await sleep(200);
        }

        // Also ensure root default English fields are populated to satisfy Angular Form validity
        const enContent = listingMap['en'] || listingMap['de'] || {};
        const setRootVal = (id: string, rawVal: string, maxLen = 2000) => {
          if (!rawVal) return;
          const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
          if (el) {
            let val = rawVal
              .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u275D\u275E]/g, '"')
              .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u275B\u275C]/g, "'");
            el.focus();
            el.value = val.substring(0, maxLen).trim();
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }
        };

        setRootVal('designCreator-productEditor-title', enContent.title || '', 60);
        setRootVal('designCreator-productEditor-brandName', enContent.brand || '', 50);
        setRootVal('designCreator-productEditor-featureBullet1', enContent.bullet1 || enContent.bullet_1 || '', 256);
        setRootVal('designCreator-productEditor-featureBullet2', enContent.bullet2 || enContent.bullet_2 || '', 256);
        setRootVal('designCreator-productEditor-description', enContent.description || '', 2000);

        return { success: true, filledLocales };
      }, { listingMap: sanitizedListings, hasTranslations: hasLocalizedListings });

      this.log(`✅ Listings für Sprachen [${fillResult.filledLocales.join(', ')}] eingetragen!`, 'Listings fertig ✓', 90, 100);

      // Scroll to bottom so action buttons are visible in screencast
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      await page.waitForTimeout(1500);

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 8.5 Publish Guard V2: Check all product results
      const technicalFailures = productUploadResults.filter(r => r.status.startsWith('FAILED_'));
      const successfulCount = productUploadResults.filter(r => r.status === 'SUCCESS').length;
      const skippedCount = productUploadResults.filter(r => r.status.startsWith('SKIPPED_')).length;

      const uploadSummary: UploadResultSummary = {
        totalRequested: totalActiveProducts,
        successful: successfulCount,
        skipped: skippedCount,
        failed: technicalFailures.length,
        results: productUploadResults
      };
      item.uploadResultSummary = uploadSummary;

      if (technicalFailures.length > 0) {
        const failureDetails = technicalFailures.map(f => `${f.productId} (${f.status}: ${f.reason || 'unbekannt'})`).join(', ');
        this.log(`🛑 PUBLISH GUARD: Upload wird gestoppt! ${technicalFailures.length} Produkt(e) mit technischem Fehler fehlgeschlagen: ${failureDetails}`, 'Publish blockiert 🛑', 90, 100);
        throw new Error(`Upload durch Publish Guard blockiert: ${technicalFailures.length} Produkt(e) fehlgeschlagen: ${failureDetails}`);
      }

      this.log(`✅ PUBLISH GUARD: Alle ${successfulCount} Produkte erfolgreich konfiguriert (${skippedCount} erwartete Skips). Freigabe erteilt!`);

      // 9. Final Action: Save Draft vs. Live Publish (with Strict Validation & State Verification)
      if (mode === 'publish') {
        if (this.pauseBeforePublishRequested) {
          this.isPausedBeforePublish = true;
          this.log(`⏸️ Upload vor Publish pausiert (Prüfmodus aktiv). Überprüfe die Amazon-Seite im Screencast!`, 'Pausiert vor Publish (Prüfmodus)', 92, 100);
          this.broadcastStatus();

          await new Promise<void>((resolve, reject) => {
            this.resumePublishResolver = resolve;
            const checkAbortInterval = setInterval(() => {
              if (this.abortRequested) {
                clearInterval(checkAbortInterval);
                this.isPausedBeforePublish = false;
                reject(new Error('Upload vom Benutzer im Prüfmodus abgebrochen.'));
              }
            }, 500);
          });

          this.isPausedBeforePublish = false;
          if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');
        }

        this.log(`🚀 Klicke 'Publish' Button für Live-Veröffentlichung...`, 'Veröffentliche...', 95, 100);

        // Check form validity before clicking
        const publishCheck = await page.evaluate(() => {
          const submitBtn = (document.getElementById('submit-button') || document.querySelector('button[id*="submit"], button.btn-submit')) as HTMLButtonElement | null;
          if (!submitBtn) return { found: false, isEnabled: false, errors: ['Publish-Button nicht gefunden'] };

          const invalidElements = Array.from(document.querySelectorAll('.has-error, .invalid-feedback, .text-danger, .alert-danger'))
            .map(el => el.textContent?.trim() || '')
            .filter(t => t.length > 0);

          const isEnabled = !submitBtn.disabled && !submitBtn.hasAttribute('disabled');
          return { found: true, isEnabled, errors: invalidElements.slice(0, 5) };
        });

        if (!publishCheck.found) throw new Error('Publish-Button im DOM nicht gefunden.');
        if (!publishCheck.isEnabled && publishCheck.errors.length > 0) {
          throw new Error(`Publish-Button ist deaktiviert. Formularfehler: ${publishCheck.errors.join(' | ')}`);
        }

        await page.evaluate(() => {
          const submitBtn = document.getElementById('submit-button') || document.querySelector('button[id*="submit"], button.btn-submit') as HTMLElement;
          submitBtn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          submitBtn?.click();
        });

        this.log(`⏳ Warte auf Bestätigungs-Modal...`, 'Bestätige Publish...');
        const confirmBtn = await page.waitForSelector('.modal-footer .btn-primary.btn-submit, button.btn-submit', { timeout: 15000 });
        if (!confirmBtn) throw new Error('Bestätigungs-Button im Publish-Modal nicht gefunden.');
        await confirmBtn.click();

        this.log(`⏳ Warte auf finale Amazon-Bestätigung (#redirect-manage)...`, 'Warte auf Bestätigung...');
        await page.waitForSelector('#redirect-manage, a[href*="/manage"]', { timeout: 60000 });
        this.log(`🎉 Design erfolgreich auf Amazon Merch veröffentlicht!`, 'Erfolgreich veröffentlicht ✓', 100, 100);
      } else {
        this.log(`💾 Klicke 'Save Draft' Button für Entwurf-Speicherung...`, 'Speichere Entwurf...', 95, 100);

        // Check if draft button is enabled and inspect any invalid characters / validation errors
        const draftCheck = await page.evaluate(() => {
          const draftBtn = (document.getElementById('draft-button') 
            || document.getElementById('save-as-draft-button')
            || document.querySelector('button[id*="draft"]')
            || document.querySelector('button.btn-draft')) as HTMLButtonElement;

          if (!draftBtn) return { found: false, isEnabled: false, errors: ['Draft-Button nicht gefunden'] };

          const invalidElements = Array.from(document.querySelectorAll('.has-error, .invalid-feedback, .text-danger, .alert-danger'))
            .map(el => el.textContent?.trim() || '')
            .filter(t => t.length > 0);

          const isEnabled = !draftBtn.disabled && !draftBtn.hasAttribute('disabled');
          return { found: true, isEnabled, errors: invalidElements.slice(0, 5) };
        });

        if (!draftCheck.found) {
          throw new Error('Save-Draft Button im DOM nicht gefunden.');
        }

        if (!draftCheck.isEnabled && draftCheck.errors.length > 0) {
          throw new Error(`Save-Draft Button ist deaktiviert. Formularfehler: ${draftCheck.errors.join(' | ')}`);
        }

        await page.evaluate(() => {
          const draftBtn = (document.getElementById('draft-button') 
            || document.getElementById('save-as-draft-button')
            || document.querySelector('button[id*="draft"]')
            || document.querySelector('button.btn-draft')) as HTMLElement;

          if (draftBtn) {
            draftBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            draftBtn.click();
          }
        });

        // Wait for Draft Saved confirmation message/toast or timer
        try {
          await page.waitForFunction(() => {
            const txt = (document.body.innerText || '').toLowerCase();
            const toast = document.querySelector('.toast, .notification, .alert-success, .success-message, [class*="alert"]');
            return txt.includes('draft saved') || txt.includes('saved as draft') || (toast && (toast.textContent || '').toLowerCase().includes('saved'));
          }, { timeout: 15000 });
          this.log(`✅ 'Draft Saved' Bestätigung von Amazon erhalten!`);
        } catch (e) {
          this.log(`⏳ Wartezeit nach Save-Draft beendet...`);
        }

        // Navigate to https://merch.amazon.com/dashboard
        this.log(`🏠 Navigiere zurück zum Dashboard (https://merch.amazon.com/dashboard)...`, 'Navigiere zu Dashboard...');
        await page.goto('https://merch.amazon.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        this.log(`🎉 Design sicher als Entwurf in Amazon Merch gespeichert & zurück auf Dashboard!`, 'Entwurf gespeichert ✓', 100, 100);
      }

      // 10. Complete Queue Item & Live Slot Refresh via Session 1
      QueueService.updateItemStatus(item.id, 'COMPLETED', undefined, item.uploadResultSummary);

      try {
        this.log(`📊 Frage aktuelle freie Tages-Upload-Slots über Session 1 (Sync & Metadata) ab...`, 'Aktualisiere freie Slots...');
        // Undefined page forces SyncEngine to query using Session 1
        const ratelimiter = await SyncEngine.fetchDashboardRatelimiter(undefined, true);
        if (ratelimiter?.slots) {
          this.log(`📈 Aktuelle Slots (Session 1): ${ratelimiter.slots.free} frei (${ratelimiter.slots.used}/${ratelimiter.slots.total} verbraucht)`);
          QueueService.setDailySlots(ratelimiter.slots.free, ratelimiter.slots.used, ratelimiter.slots.total);
        }
      } catch (err: any) {
        console.warn('[UploadWorker] Could not refresh ratelimiter metadata in Session 1:', err?.message);
      }

      QueueService.rebalanceQueue();
      this.isUploading = false;
      this.currentStep = 'Abgeschlossen ✓';
      this.stepIndex = 100;
      this.broadcastStatus();

    } catch (err: any) {
      const errorMsg = err.message || 'Unbekannter Fehler während des Uploads';
      this.log(`❌ Upload Fehler: ${errorMsg}`, `Fehler: ${errorMsg}`);
      QueueService.updateItemStatus(item.id, 'ERROR', errorMsg, item.uploadResultSummary);
      QueueService.rebalanceQueue();
      this.isUploading = false;
      this.broadcastStatus();
    }
  }
}
