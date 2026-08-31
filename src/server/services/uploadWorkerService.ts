import path from 'path';
import fs from 'fs';
import { BrowserSessionService } from './browserSessionService';
import { QueueService, QueueItem } from './queueService';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
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
        // In Edit Mode, existing artwork is usually already attached on Amazon
        const hasExistingArtwork = await page.evaluate(() => {
          const img = document.querySelector('#STANDARD_TSHIRT-card .asset img, .asset img, #global-uploader-container img.artwork') as HTMLImageElement;
          return Boolean(img && ((img.naturalWidth && img.naturalWidth > 0) || (img.src && img.src.length > 0)));
        });

        if (hasExistingArtwork) {
          this.log(`🖼️ Bestehendes Artwork auf Amazon Create-Seite vorhanden ✓`, 'Artwork vorhanden', 25, 100);
        } else if (pngAbsolutePath && fs.existsSync(pngAbsolutePath)) {
          this.log(`📤 Lade Master-PNG für Update hoch (${path.basename(pngAbsolutePath)})...`, 'Lade PNG hoch...', 20, 100);
          const fileInput = await page.waitForSelector('.dropzone-container input[type="file"], input[type="file"].file-upload-input, input[type="file"]', { 
            state: 'attached', 
            timeout: 20000 
          });
          if (fileInput) {
            await fileInput.setInputFiles(pngAbsolutePath);
          }
        }
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
      }

      // Wait for artwork to render on product card (#STANDARD_TSHIRT-card .asset img or .asset img)
      try {
        await page.waitForFunction(() => {
          const img = document.querySelector('#STANDARD_TSHIRT-card .asset img, .asset img, #global-uploader-container img.artwork') as HTMLImageElement;
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

        // Perform fast double-check state synchronization inside the modal
        const modalResult = await page.evaluate(async (activeMap: Record<string, string[]>) => {
          const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
          const modal = Array.from(document.querySelectorAll('.modal-content, .modal-dialog, merch-modal, .modal'))
            .find(el => {
              const r = el.getBoundingClientRect();
              return r.height > 0 && r.width > 0;
            });
          if (!modal) return { success: true, modifiedCount: 0 };

          let modifiedCount = 0;
          const products = Object.keys(activeMap);

          for (const pid of products) {
            const desiredMarketplaces = new Set(activeMap[pid] || []);
            const allMarketplaces = ['US', 'DE', 'GB', 'FR', 'IT', 'ES', 'JP'];

            for (const mp of allMarketplaces) {
              const selector = `flowcheckbox[class*="${pid}-${mp}"]`;
              const cb = modal.querySelector(selector) as HTMLElement;
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
        }, item.activeProductsMap);

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
      const sortedCatalogProducts = [...catalog.products].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
      
      // Filter products that have at least 1 active marketplace
      const activeProductsToProcess = sortedCatalogProducts.filter(p => {
        const mps = item.activeProductsMap[p.id];
        return Array.isArray(mps) && mps.length > 0;
      });

      const totalActiveProducts = activeProductsToProcess.length;
      this.log(`👕 Bearbeite ${totalActiveProducts} aktive Produkte sequenziell...`, 'Bearbeite Produktdetails...', 52, 100);

      const avoidColor = item.avoidColor || 'none';
      let fitTypes = item.fitTypes || ['men', 'women', 'youth'];
      
      // Rule: If in question phase only 'Youth' is selected, automatically include 'Men' as well
      const normalizedFits = fitTypes.map(f => f.toLowerCase());
      if (normalizedFits.includes('youth') && !normalizedFits.includes('men') && !normalizedFits.includes('women')) {
        fitTypes = [...fitTypes, 'men'];
      }

      const customBgColor = item.customBackgroundColor || (avoidColor === 'black' ? '#FFFFFF' : '#000000');

      for (let i = 0; i < totalActiveProducts; i++) {
        if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

        const product = activeProductsToProcess[i];
        const stepProgress = 52 + Math.round(((i + 1) / totalActiveProducts) * 28); // 52% to 80%

        this.log(`[${i + 1}/${totalActiveProducts}] Öffne & prüfe "${product.displayName}"...`, `Bearbeite ${product.displayName}`, stepProgress, 100);

        // Säule 3: Robuster "Edit details" Klick- & Öffnungs-Check mit aktiver Verifikation & Retries
        let editorOpened = false;
        let openRetries = 0;
        const maxOpenRetries = 3;

        while (!editorOpened && openRetries < maxOpenRetries) {
          openRetries++;

          const openResult = await page.evaluate(async (pid: string) => {
            const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

            // 1. Check if editor for this product is already visible and open
            const existingEditor = document.querySelector(`product-editor .${pid}-container`)?.closest('product-editor') 
              || document.querySelector(`product-editor[id*="${pid}"]`)
              || document.querySelector(`product-editor .${pid}-editor`) as HTMLElement;

            if (existingEditor && existingEditor.offsetHeight > 40) {
              return { success: true, isAlreadyOpen: true };
            }

            // 2. Locate the "Edit details" button with all known Merch selectors
            const editBtn = (document.querySelector(`.${pid}-edit-btn`) 
              || document.querySelector(`#${pid}-card .edit-button`) 
              || document.querySelector(`#${pid}-card button.edit-btn`)
              || document.querySelector(`button[class*="${pid}-edit"]`)
              || Array.from(document.querySelectorAll(`#${pid}-card button, .${pid}-container button, [id*="${pid}"] button, div[class*="${pid}"] button`))
                  .find(b => b.textContent?.trim().toLowerCase().includes('edit'))) as HTMLElement;

            if (!editBtn) {
              return { success: false, reason: `Edit button für ${pid} nicht im DOM gefunden` };
            }

            // 3. Scroll cleanly to button
            editBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(200);

            // 4. Fire full mouse event suite to reliably trigger Angular component
            editBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            editBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            editBtn.click();

            // 5. Active polling: Wait up to 2000ms until product-editor container is rendered
            const startWait = Date.now();
            while (Date.now() - startWait < 2000) {
              await sleep(150);
              const ed = document.querySelector(`product-editor .${pid}-container`)?.closest('product-editor') 
                || document.querySelector(`product-editor[id*="${pid}"]`)
                || document.querySelector(`product-editor .${pid}-editor`)
                || document.querySelector('product-editor') as HTMLElement;

              if (ed && ed.offsetHeight > 40) {
                return { success: true, isAlreadyOpen: false };
              }
            }

            return { success: false, reason: `Editor für ${pid} hat sich nach 2000ms nicht geöffnet` };
          }, product.id);

          if (openResult.success) {
            editorOpened = true;
          } else {
            this.log(`⚠️ Versuch ${openRetries}/${maxOpenRetries} für "${product.displayName}": ${openResult.reason} - wiederhole...`);
            await page.waitForTimeout(400);
          }
        }

        if (!editorOpened) {
          this.log(`❌ Konnte Editor für "${product.displayName}" nach ${maxOpenRetries} Versuchen nicht öffnen! Überspringe...`);
          continue;
        }

        // Säulen 1 & 2: Konfiguration mit Fit-Type Garantie, Swatch-Audit & Minimum-1 Farbe Selbstheilung
        const editResult = await page.evaluate(async (params: {
          productId: string;
          colorMode: string;
          fitTypes: string[];
          avoidColor: string;
          customBgColor: string;
          catalogColors: Array<{ id: string; avoidRule?: 'none' | 'white' | 'black' }>;
        }) => {
          const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
          const pid = params.productId;

          const editor = document.querySelector(`product-editor .${pid}-container`)?.closest('product-editor') 
            || document.querySelector(`product-editor[id*="${pid}"]`)
            || document.querySelector('product-editor') as HTMLElement;

          if (!editor) return { success: false, reason: `Editor container for ${pid} not found` };

          // Helper 1: Element checked state (checks true container/parent flowcheckbox)
          const isElementChecked = (el: Element): boolean => {
            const target = el.closest('flowcheckbox') || el;

            // 1. Angular SCI Icon check (Authoritative on Merch by Amazon)
            const icon = target.querySelector('.sci-icon, i, svg');
            if (icon) {
              if (icon.classList.contains('sci-check-box-blank') || icon.classList.contains('sci-checkbox-blank')) {
                return false;
              }
              if (icon.classList.contains('sci-check-box') || icon.classList.contains('sci-checkbox') || icon.classList.contains('checkmark')) {
                return true;
              }
            }

            // 2. Direct input checkbox
            const input = target.querySelector('input[type="checkbox"], input') as HTMLInputElement;
            if (input && typeof input.checked === 'boolean') {
              return input.checked;
            }
            if (target instanceof HTMLInputElement && typeof target.checked === 'boolean') {
              return target.checked;
            }

            // 3. Aria attributes or classes
            if (target.getAttribute('aria-checked') === 'true') return true;
            if (target.getAttribute('aria-checked') === 'false') return false;

            const hasSelectedClass = target.classList.contains('selected') || 
              target.classList.contains('checked') || 
              target.classList.contains('active') ||
              target.querySelector('.selected, .checked, .active') !== null;

            return hasSelectedClass;
          };

          // Helper 2: Click element (triggers Angular @HostListener and native events)
          const clickTargetElement = (el: Element) => {
            const host = (el.closest('flowcheckbox') || el) as HTMLElement;
            host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            host.click();

            const input = host.querySelector('input') as HTMLInputElement;
            if (input) {
              input.click();
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
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

          const KNOWN_COLORS: { id: string; matchers: string[] }[] = [
            { id: 'black', matchers: ['black', 'schwarz'] },
            { id: 'white', matchers: ['white', 'weiß', 'weiss'] },
            { id: 'navy', matchers: ['navy', 'dunkelblau'] },
            { id: 'asphalt', matchers: ['asphalt'] },
            { id: 'dark_heather', matchers: ['dark_heather', 'dark-heather', 'dark heather', 'darkheather'] },
            { id: 'heather_grey', matchers: ['heather_grey', 'heather-grey', 'heather grey', 'heathergrey', 'heather gray', 'heather_gray'] },
            { id: 'royal', matchers: ['royal', 'royal_blue', 'royal-blue', 'royal blue', 'royalblue'] },
            { id: 'red', matchers: ['red', 'rot'] },
            { id: 'olive', matchers: ['olive'] },
            { id: 'kelly_green', matchers: ['kelly_green', 'kelly-green', 'kelly green', 'kellygreen'] },
            { id: 'baby_blue', matchers: ['baby_blue', 'baby-blue', 'baby blue', 'babyblue'] },
            { id: 'pink', matchers: ['pink', 'rosa'] },
            { id: 'purple', matchers: ['purple', 'lila'] },
            { id: 'orange', matchers: ['orange'] },
            { id: 'lemon', matchers: ['lemon', 'yellow', 'gelb'] },
            { id: 'cranberry', matchers: ['cranberry'] },
            { id: 'brown', matchers: ['brown', 'braun'] },
            { id: 'silver', matchers: ['silver', 'silber'] },
            { id: 'slate', matchers: ['slate'] },
            { id: 'sage_green', matchers: ['sage_green', 'sage-green', 'sage green', 'sagegreen', 'sage'] },
            { id: 'tan', matchers: ['tan'] },
            { id: 'heather_blue', matchers: ['heather_blue', 'heather-blue', 'heather blue', 'heatherblue'] },
            { id: 'black_white', matchers: ['black_white', 'black-white', 'black white'] },
            { id: 'navy_white', matchers: ['navy_white', 'navy-white', 'navy white'] },
            { id: 'red_white', matchers: ['red_white', 'red-white', 'red white'] },
            { id: 'royal_blue_white', matchers: ['royal_blue_white', 'royal-white', 'royal_white', 'royal white'] },
            { id: 'dark_heather_white', matchers: ['dark_heather_white', 'dark_heather-white', 'dark heather white'] },
            { id: 'white_black', matchers: ['white_black', 'white-black', 'white black'] },
            { id: 'white_white', matchers: ['white_white', 'white-white', 'white white'] },
            { id: 'black_black', matchers: ['black_black', 'black-black', 'black black'] }
          ];

          const identifyColorId = (haystack: string): string => {
            for (const col of KNOWN_COLORS) {
              if (col.matchers.some(m => haystack.includes(m))) return col.id;
            }
            return '';
          };

          // -------------------------------------------------------------
          // STEP A: Fit Types Configuration & Minimum-1 Fit Type Guarantee
          // -------------------------------------------------------------
          let desiredFits = params.fitTypes.map(f => f.toLowerCase());
          if (desiredFits.includes('youth') && !desiredFits.includes('men') && !desiredFits.includes('women')) {
            desiredFits.push('men');
          }
          if (desiredFits.includes('youth') && !desiredFits.includes('girls')) {
            desiredFits.push('girls');
          }
          desiredFits.push('adult_unisex', 'unisex');

          // Find genuine fit checkbox elements (excluding color swatches)
          const allCheckboxes = Array.from(editor.querySelectorAll('flowcheckbox, input[type="checkbox"], .fit-checkbox')) as HTMLElement[];
          const fitCandidateCheckboxes = allCheckboxes.filter(cb => {
            const isColor = cb.tagName.toLowerCase() === 'colorcheckbox' || 
              cb.classList.contains('color-checkbox') || 
              (cb.getAttribute('formcontrolname') || '').toLowerCase().includes('color') ||
              cb.closest('.color-selection-container') !== null;
            return !isColor;
          });

          const fitControlsMap = new Map<string, HTMLElement>();

          for (const cb of fitCandidateCheckboxes) {
            const fcn = (cb.getAttribute('formcontrolname') || '').toLowerCase();
            const name = (cb.getAttribute('name') || '').toLowerCase();
            const id = (cb.getAttribute('id') || '').toLowerCase();
            const cls = (cb.className || '').toLowerCase();
            const labelTxt = (cb.querySelector('label')?.textContent || cb.textContent || '').trim().toLowerCase();
            const combo = `${fcn} ${name} ${id} ${cls} ${labelTxt}`;

            let fitKey = '';
            if (fcn === 'men' || fcn === 'fittypemen' || cls.includes('men-checkbox') || id.includes('men') || labelTxt === 'men' || labelTxt === 'männer' || labelTxt === 'herren') {
              fitKey = 'men';
            } else if (fcn === 'women' || fcn === 'fittypewomen' || cls.includes('women-checkbox') || id.includes('women') || labelTxt === 'women' || labelTxt === 'frauen' || labelTxt === 'damen') {
              fitKey = 'women';
            } else if (fcn === 'youth' || fcn === 'fittypeyouth' || cls.includes('youth-checkbox') || id.includes('youth') || labelTxt === 'youth' || labelTxt === 'kinder' || labelTxt === 'kids') {
              fitKey = 'youth';
            } else if (fcn === 'girls' || fcn === 'fittypegirls' || cls.includes('girls-checkbox') || id.includes('girls') || labelTxt === 'girls' || labelTxt === 'mädchen') {
              fitKey = 'girls';
            } else if (combo.includes('unisex')) {
              fitKey = 'adult_unisex';
            } else if (combo.includes('girls') || combo.includes('mädchen') || combo.includes('girl')) {
              fitKey = 'girls';
            } else if (combo.includes('youth') || combo.includes('kinder') || combo.includes('kids')) {
              fitKey = 'youth';
            } else if (combo.includes('women') || combo.includes('frauen') || combo.includes('damen')) {
              fitKey = 'women';
            } else if (/\bmen\b/.test(combo) || combo.includes('männer') || combo.includes('herren')) {
              fitKey = 'men';
            }

            if (fitKey) {
              fitControlsMap.set(fitKey, cb);
            }
          }

          // Apply fit selections: EXACTLY ONE check/click per distinct fitKey with active verification
          const activeFitsApplied: string[] = [];
          for (const [fitKey, cb] of fitControlsMap.entries()) {
            const shouldBeChecked = desiredFits.includes(fitKey) || fitKey === 'adult_unisex';
            let isChecked = isElementChecked(cb);

            if (isChecked !== shouldBeChecked) {
              clickTargetElement(cb);
              await sleep(80);
              isChecked = isElementChecked(cb);
            }

            if (isChecked) {
              activeFitsApplied.push(fitKey);
            }
          }

          // Verification & Minimum-1 Self-Healing
          if (fitControlsMap.size > 0 && activeFitsApplied.length === 0) {
            const fallbackKey = fitControlsMap.has('men') ? 'men' : fitControlsMap.keys().next().value;
            if (fallbackKey) {
              const fallbackCb = fitControlsMap.get(fallbackKey)!;
              clickTargetElement(fallbackCb);
              await sleep(80);
              activeFitsApplied.push(fallbackKey);
            }
          }

          // -------------------------------------------------------------
          // STEP B: Color Selection (Custom Picker vs Swatches)
          // -------------------------------------------------------------
          let finalActiveColorNames: string[] = [];
          let selfHealedColor = '';

          if (params.colorMode === 'customPicker') {
            // Hex color picker mode
            const colorBtn = (editor.querySelector('#color-btn') 
              || editor.querySelector('button[id*="color-btn"]')
              || editor.querySelector('.background-color-picker-button')
              || editor.querySelector('button.color-btn')
              || editor.querySelector('.color-picker-button')
              || document.querySelector('#color-btn')) as HTMLElement;

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
                || document.querySelector('.sketch-picker, .color-picker-container, ngb-popover-window, color-sketch, .color-picker-popover') as HTMLElement;

              if (popover) {
                const cleanHex = (params.customBgColor || '000000').replace(/^#/, '').toUpperCase();

                const swatches = Array.from(popover.querySelectorAll('.sketch-swatches div, .sketch-swatches span, .sketch-swatches [title], .sketch-swatches [style]')) as HTMLElement[];
                let matchedSwatch: HTMLElement | null = null;
                for (const sw of swatches) {
                  const title = (sw.getAttribute('title') || '').replace(/^#/, '').toUpperCase();
                  const style = (sw.getAttribute('style') || '').toLowerCase();
                  if (title === cleanHex || (cleanHex.length === 6 && title === cleanHex.slice(0, 3))) {
                    matchedSwatch = sw;
                    break;
                  }
                  if ((cleanHex === '000000' || cleanHex === '000') && (style.includes('rgb(0, 0, 0)') || style.includes('#000000') || title === '000000' || title === '#000000')) {
                    matchedSwatch = sw;
                    break;
                  }
                  if ((cleanHex === 'FFFFFF' || cleanHex === 'FFF') && (style.includes('rgb(255, 255, 255)') || style.includes('#ffffff') || title === 'FFFFFF' || title === '#FFFFFF')) {
                    matchedSwatch = sw;
                    break;
                  }
                }

                if (matchedSwatch) {
                  matchedSwatch.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                  matchedSwatch.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                  matchedSwatch.click();
                  await sleep(150);
                }

                let hexInput = (popover.querySelector('color-editable-input[label="hex"] input, div[label="hex"] input, input[aria-label="hex"]')
                  || popover.querySelector('.wrap input')
                  || popover.querySelector('input[type="text"]')
                  || popover.querySelector('input')) as HTMLInputElement;

                if (hexInput) {
                  hexInput.focus();
                  hexInput.value = '';
                  hexInput.dispatchEvent(new Event('input', { bubbles: true }));
                  hexInput.dispatchEvent(new Event('change', { bubbles: true }));
                  await sleep(50);

                  for (const char of cleanHex) {
                    hexInput.value += char;
                    hexInput.dispatchEvent(new Event('input', { bubbles: true }));
                    await sleep(25);
                  }
                  hexInput.dispatchEvent(new Event('change', { bubbles: true }));
                  hexInput.blur();
                }
                finalActiveColorNames.push(`#${cleanHex}`);
              }
            }
          } else {
            // Swatches Mode (Predefined Colors)
            const colorCheckboxes = Array.from(editor.querySelectorAll('colorcheckbox, .color-checkbox, flowcheckbox[class*="color"]'));

            // PASS 1: Apply user's Product Catalog definitions exclusively (Single Source of Truth)
            for (const cb of colorCheckboxes) {
              const haystack = extractColorClues(cb);
              const matchedColorId = identifyColorId(haystack);

              // 1. Find matching color definition from product catalog
              let matchedConfig: { id: string; avoidRule?: 'none' | 'white' | 'black' } | undefined;

              if (params.catalogColors && params.catalogColors.length > 0) {
                matchedConfig = params.catalogColors.find((c: any) => 
                  (matchedColorId && c.id === matchedColorId) || 
                  haystack.includes(c.id) ||
                  (matchedColorId && c.id.includes(matchedColorId))
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

            // PASS 3: SELBSTHEILUNG BEI 0 FARBEN (Sicherheitsnetz falls 0 Farben übrig blieben)
            if (activeSwatches.length === 0 && colorCheckboxes.length > 0) {
              // 1. Suche aus den im Katalog definierten Farben die erste Farbe, deren avoidRule !== params.avoidColor ist
              let fallbackSwatch = colorCheckboxes.find(cb => {
                const h = extractColorClues(cb);
                const mid = identifyColorId(h);
                const cfg = params.catalogColors?.find((c: any) => (mid && c.id === mid) || h.includes(c.id));
                if (!cfg) return false;
                return cfg.avoidRule !== params.avoidColor;
              });

              // 2. Falls keine gefunden: Erstes verfügbares Katalog-Swatch
              if (!fallbackSwatch) {
                fallbackSwatch = colorCheckboxes.find(cb => {
                  const h = extractColorClues(cb);
                  const mid = identifyColorId(h);
                  return params.catalogColors?.some((c: any) => (mid && c.id === mid) || h.includes(c.id));
                });
              }

              // 3. Absolute Notfall-Garantie: Erstes verfügbares Swatch
              if (!fallbackSwatch) {
                fallbackSwatch = colorCheckboxes[0];
              }

              clickTargetElement(fallbackSwatch);
              await sleep(100);

              const h = extractColorClues(fallbackSwatch);
              selfHealedColor = identifyColorId(h) || 'Fallback Color';
              activeSwatches = colorCheckboxes.filter(cb => isElementChecked(cb));
            }

            // PASS 4: Finale Namen der aktivierten Farben für das Live-Log auslesen
            finalActiveColorNames = activeSwatches.map(cb => {
              const h = extractColorClues(cb);
              const id = identifyColorId(h);
              if (id) return id;
              return cb.getAttribute('name') || cb.getAttribute('title') || 'Color';
            });
          }

          return { 
            success: true, 
            activeColors: finalActiveColorNames,
            fitTypesApplied: activeFitsApplied,
            selfHealedColor
          };
        }, {
          productId: product.id,
          colorMode: product.colorMode,
          fitTypes,
          avoidColor: String(avoidColor).toLowerCase(),
          customBgColor,
          catalogColors: Array.isArray(product.colors) ? product.colors.map(c => ({ id: c.id.toLowerCase(), avoidRule: c.avoidRule || 'none' })) : []
        });

        if (editResult.success) {
          if (editResult.selfHealedColor) {
            this.log(`⚠️ ${product.displayName}: 0 Farben verhindert ➔ Selbstheilung: "${editResult.selfHealedColor}" aktiviert ✓`);
          } else {
            const colorsList = editResult.activeColors && editResult.activeColors.length > 0 ? editResult.activeColors.join(', ') : 'OK';
            const fitsList = editResult.fitTypesApplied && editResult.fitTypesApplied.length > 0 ? editResult.fitTypesApplied.join(', ') : 'Standard';
            this.log(`✓ ${product.displayName}: ${editResult.activeColors?.length || 1} Farben (${colorsList}) | Fit: ${fitsList}`);
          }
        } else {
          this.log(`⚠️ Hinweis zu ${product.displayName}: ${editResult.reason}`);
        }

        await page.waitForTimeout(300);
      }

      this.log(`✅ Alle ${totalActiveProducts} Produkte erfolgreich konfiguriert & verifiziert!`, 'Produktdetails fertig ✓', 80, 100);

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 7. Auto-Translate Toggle to 'NO'
      this.log(`🌍 Deaktiviere Amazon Auto-Übersetzung (Eigene mehrsprachige Listings)...`, 'Setze Übersetzung auf NO...', 82, 100);
      await page.evaluate(async () => {
        const autoTranslateRadioNo = document.getElementById('translation-request-no') as HTMLInputElement;
        if (autoTranslateRadioNo && !autoTranslateRadioNo.checked) {
          autoTranslateRadioNo.click();
        }
      });
      await page.waitForTimeout(1000);

      // 8. Multi-Language Listings Injection (with Length Clamping & Angular Events)
      this.log(`📝 Trage mehrsprachige SEO-Listings ein (inkl. Zeichen-Bereinigung)...`, 'Befülle Listings...', 85, 100);
      const rawListings = item.listings || {
        en: { brand: item.brand, title: item.title, bullet1: item.bullet1, bullet2: item.bullet2, description: item.description }
      };

      // Sanitize all listings on server first
      const sanitizedListings: Record<string, any> = {};
      for (const [loc, content] of Object.entries(rawListings)) {
        if (!content) continue;
        sanitizedListings[loc] = {
          brand: UploadWorkerService.sanitizeListingText(content.brand || '', loc),
          title: UploadWorkerService.sanitizeListingText(content.title || '', loc),
          bullet1: UploadWorkerService.sanitizeListingText(content.bullet1 || content.bullet_1 || '', loc),
          bullet2: UploadWorkerService.sanitizeListingText(content.bullet2 || content.bullet_2 || '', loc),
          description: UploadWorkerService.sanitizeListingText(content.description || '', loc),
        };
      }

      const fillResult = await page.evaluate(async (listingMap: Record<string, any>) => {
        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
        const locales = ['en', 'de', 'fr', 'it', 'es', 'ja'];
        const filledLocales: string[] = [];

        // Scroll to listings section
        const listingSection = document.getElementById('translation-request-no') || document.querySelector('product-editor-listing') || document.getElementById('designCreator-productEditor-title');
        if (listingSection) {
          listingSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(300);
        }

        for (const loc of locales) {
          const content = listingMap[loc] || (loc === 'ja' ? listingMap['jp'] : null) || listingMap['en'];
          if (!content) continue;

          // Expand locale tab
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
      }, sanitizedListings);

      this.log(`✅ Listings für Sprachen [${fillResult.filledLocales.join(', ')}] eingetragen!`, 'Listings fertig ✓', 90, 100);

      // Scroll to bottom so action buttons are visible in screencast
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      await page.waitForTimeout(1500);

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

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
          const submitBtn = document.getElementById('submit-button') || document.querySelector('button[id*="submit"], button.btn-submit') as HTMLButtonElement;
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
      QueueService.updateItemStatus(item.id, 'COMPLETED');

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
      QueueService.updateItemStatus(item.id, 'ERROR', errorMsg);
      QueueService.rebalanceQueue();
      this.isUploading = false;
      this.broadcastStatus();
    }
  }
}
