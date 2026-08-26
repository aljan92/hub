import path from 'path';
import fs from 'fs';
import { BrowserSessionService } from './browserSessionService';
import { QueueService, QueueItem } from './queueService';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
import { Page } from 'playwright';

export interface UploadProgressState {
  isUploading: boolean;
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
    this.log('🛑 Upload-Abbruch angefordert...', 'Wird abgebrochen...');
    return true;
  }

  /**
   * Start upload for a specific queue item or next item in queue
   */
  public static async startUpload(queueItemId?: string, mode: 'draft' | 'publish' = 'draft'): Promise<{ success: boolean; message: string }> {
    if (this.isUploading) {
      return { success: false, message: 'Es läuft bereits ein Upload-Vorgang.' };
    }

    const state = QueueService.getState();
    let targetItem: QueueItem | undefined;

    if (queueItemId) {
      targetItem = state.items.find(i => i.id === queueItemId);
    } else {
      // Pick first scheduled or waiting item
      targetItem = state.items.find(i => i.status === 'SCHEDULED_TODAY') || state.items.find(i => i.status === 'WAITING_FOR_SLOTS');
    }

    if (!targetItem) {
      return { success: false, message: 'Kein bereitstehendes Design in der Queue gefunden.' };
    }

    this.isUploading = true;
    this.abortRequested = false;
    this.currentQueueId = targetItem.id;
    this.currentTaskId = targetItem.taskId;
    this.currentDesignTitle = targetItem.title || targetItem.designTitle;
    this.currentMode = mode;
    this.stepIndex = 0;
    this.totalSteps = 100;
    this.logs = [];

    // Mark as UPLOADING in queue
    QueueService.updateItemStatus(targetItem.id, 'UPLOADING');

    // Run upload execution asynchronously
    this.executeUploadPipeline(targetItem, mode).catch(err => {
      console.error('[UploadWorker] Critical pipeline error:', err);
    });

    return { success: true, message: `Upload für Task #${targetItem.taskId} gestartet (${mode.toUpperCase()} Modus).` };
  }

  /**
   * Main Upload Execution Pipeline
   */
  private static async executeUploadPipeline(item: QueueItem, mode: 'draft' | 'publish') {
    const uploadUrl = 'https://merch.amazon.com/designs/new';

    try {
      this.log(`🚀 Starte Upload für Task #${item.taskId} ("${item.title || item.designTitle}")`, 'Initialisiere Session 2...', 5, 100);

      // 1. Ensure Session 2 (Upload) is active
      const session = await BrowserSessionService.getSession('upload');
      const page = session.page;

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 2. Navigate to https://merch.amazon.com/designs/new
      this.log(`🌐 Öffne ${uploadUrl}`, 'Öffne Merch Create Seite...', 10, 100);
      await page.goto(uploadUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);

      // Check for login required
      const currentUrl = page.url();
      if (currentUrl.includes('/signin') || currentUrl.includes('/ap/signin')) {
        this.log(`⚠️ Amazon Login erforderlich. Bitte im Screencast (Session 2) einloggen!`, 'Warte auf Login...');
        // Wait up to 3 minutes for user to sign in
        await page.waitForURL('**/designs/new**', { timeout: 180000 });
        this.log(`✅ Login erkannt! Fahre mit Upload fort...`, 'Login erfolgreich');
      }

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 3. Prepare PNG File
      this.log(`🖼️ Überprüfe Master-PNG Datei...`, 'Prüfe Druckdatei...', 15, 100);
      let pngAbsolutePath = '';

      if (item.pngPath && fs.existsSync(item.pngPath)) {
        pngAbsolutePath = path.resolve(item.pngPath);
      } else {
        // Fallback checks
        const candidatePaths = [
          path.resolve(process.cwd(), 'data', 'designs', `${item.taskId}.png`),
          path.resolve(process.cwd(), 'data', 'designs', `${item.taskId.replace('#', '')}.png`),
          path.resolve(process.cwd(), 'data', 'designs', `${item.taskId}_mba_print.png`)
        ];
        for (const cp of candidatePaths) {
          if (fs.existsSync(cp)) {
            pngAbsolutePath = cp;
            break;
          }
        }
      }

      if (!pngAbsolutePath || !fs.existsSync(pngAbsolutePath)) {
        throw new Error(`Druckfertige 4500x5400px PNG-Datei für Task #${item.taskId} nicht gefunden.`);
      }

      // 4. Inject PNG File into Dropzone (File Input is hidden in DOM with hidden="" attribute)
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

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 5. Select Products Modal (Intelligent Double-Check Selection)
      this.log(`📦 Öffne 'Select Products' Modal...`, 'Konfiguriere Marktplätze...', 40, 100);
      const selectBtn = await page.waitForSelector('#select-marketplace-button-original', { timeout: 15000 });
      if (selectBtn) {
        await selectBtn.click();
        await page.waitForSelector('.modal-content, .modal-dialog, merch-modal', { timeout: 10000 });
        await page.waitForTimeout(400);

        // Perform fast double-check state synchronization inside the modal
        const modalResult = await page.evaluate(async (activeMap: Record<string, string[]>) => {
          const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
          const modal = document.querySelector('.modal-content, .modal-dialog, merch-modal, .modal');
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
                // Click to flip
                cb.click();
                modifiedCount++;
                await sleep(10);

                // Double check state
                const afterIcon = cb.querySelector('.sci-icon');
                const isAfterChecked = afterIcon ? afterIcon.classList.contains('sci-check-box') : false;
                if (isAfterChecked !== shouldBeChecked) {
                  cb.click();
                  await sleep(10);
                }
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
            // Text content fallback
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

          // If no button found, check if modal is already gone
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
        await page.waitForTimeout(800);

        this.log(`✅ Marktplatz-Matrix synchronisiert (${modalResult.modifiedCount} Checkboxen angepasst)`, 'Produkte gewählt ✓', 50, 100);
      }

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 6. Sequential Product Details Configuration (Dynamic Catalog Driven)
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
      const fitTypes = item.fitTypes || ['men', 'women', 'youth'];
      const customBgColor = item.customBackgroundColor || (avoidColor === 'black' ? '#FFFFFF' : '#000000');

      for (let i = 0; i < totalActiveProducts; i++) {
        if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

        const product = activeProductsToProcess[i];
        const stepProgress = 52 + Math.round(((i + 1) / totalActiveProducts) * 28); // 52% to 80%

        this.log(`[${i + 1}/${totalActiveProducts}] Konfiguriere "${product.displayName}"...`, `Bearbeite ${product.displayName}`, stepProgress, 100);

        const editResult = await page.evaluate(async (params: {
          productId: string;
          colorMode: string;
          fitTypes: string[];
          avoidColor: string;
          customBgColor: string;
        }) => {
          const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
          const pid = params.productId;

          // 1. Click "Edit details" button with fallback selectors
          const editBtn = (document.querySelector(`.${pid}-edit-btn`) 
            || document.querySelector(`#${pid}-card .edit-button`) 
            || document.querySelector(`#${pid}-card button.edit-btn`)
            || document.querySelector(`button[class*="${pid}-edit"]`)
            || Array.from(document.querySelectorAll(`#${pid}-card button`)).find(b => b.textContent?.trim().toLowerCase().includes('edit'))) as HTMLElement;

          if (!editBtn) return { success: false, reason: `Edit button for ${pid} not found` };

          editBtn.click();
          await sleep(350);

          // 2. Locate opened editor
          const editor = document.querySelector(`product-editor .${pid}-container`)?.closest('product-editor') 
            || document.querySelector(`product-editor[id*="${pid}"]`)
            || document.querySelector('product-editor');
          if (!editor) return { success: false, reason: `Editor container for ${pid} not found` };

          // 3. Configure Fit Types (Men, Women, Youth)
          const allFitLabels: Record<string, HTMLElement | null> = {
            men: editor.querySelector('label.men-label'),
            women: editor.querySelector('label.women-label'),
            youth: editor.querySelector('label.youth-label')
          };

          for (const [ft, label] of Object.entries(allFitLabels)) {
            if (label) {
              const icon = label.querySelector('i.sci-icon');
              const isChecked = icon ? icon.classList.contains('sci-check-box') : false;
              const shouldBeChecked = params.fitTypes.includes(ft);

              if (isChecked !== shouldBeChecked) {
                label.click();
                await sleep(50);
              }
            }
          }

          // 4. Configure Colors
          if (params.colorMode === 'customPicker') {
            // Hex color picker mode (Accessories, PopSockets, Cases, Mugs, etc.)
            const colorBtn = editor.querySelector('.background-color-picker-button, #color-btn, button[id*="color-btn"]') as HTMLElement;
            if (colorBtn) {
              colorBtn.click();
              await sleep(300);

              const picker = document.querySelector('.sketch-picker, .color-picker-container, ngb-popover-window, color-sketch');
              if (picker) {
                const hexInput = picker.querySelector('input') as HTMLInputElement;
                if (hexInput) {
                  const cleanHex = params.customBgColor.replace('#', '');
                  hexInput.value = cleanHex;
                  hexInput.dispatchEvent(new Event('input', { bubbles: true }));
                  hexInput.dispatchEvent(new Event('change', { bubbles: true }));
                  await sleep(150);
                }
                // Close popover
                const doneBtn = picker.querySelector('button.done-button, button[type="submit"]') as HTMLElement;
                if (doneBtn) doneBtn.click();
                else document.body.click();
                await sleep(200);
              }
            }
          } else {
            // Swatches mode (Apparel)
            const colorCheckboxes = Array.from(editor.querySelectorAll('colorcheckbox'));
            for (const cb of colorCheckboxes) {
              const colorClass = Array.from(cb.classList).find(c => c.endsWith('-checkbox')) || '';
              const colorName = colorClass.replace('-checkbox', '').toLowerCase().replace(/[\s_]+/g, '');

              let shouldBeChecked = true;
              if (params.avoidColor === 'white') {
                if (colorName === 'white' || (pid.toUpperCase().includes('RAGLAN') && colorName.includes('white'))) {
                  shouldBeChecked = false;
                }
              } else if (params.avoidColor === 'black') {
                if (colorName === 'black') {
                  shouldBeChecked = false;
                }
              }

              const icon = cb.querySelector('i.sci-icon');
              const isChecked = icon ? icon.classList.contains('checkmark') : false;

              if (isChecked !== shouldBeChecked) {
                const input = cb.querySelector('input[type="checkbox"]') as HTMLElement;
                if (input) input.click();
                else (cb as HTMLElement).click();
                await sleep(40);
              }
            }
          }

          // Modular Price Placeholder: prices stay at Amazon defaults for now
          return { success: true };
        }, {
          productId: product.id,
          colorMode: product.colorMode,
          fitTypes,
          avoidColor,
          customBgColor
        });

        if (!editResult.success) {
          this.log(`⚠️ Hinweis zu ${product.displayName}: ${editResult.reason}`);
        }
        await page.waitForTimeout(200);
      }

      this.log(`✅ Alle ${totalActiveProducts} Produkte erfolgreich konfiguriert!`, 'Produktdetails fertig ✓', 80, 100);

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

      // 8. Multi-Language Listings Injection
      this.log(`📝 Trage mehrsprachige SEO-Listings ein...`, 'Befülle Listings...', 85, 100);
      const listings = item.listings || {
        en: { brand: item.brand, title: item.title, bullet1: item.bullet1, bullet2: item.bullet2, description: item.description }
      };

      const fillResult = await page.evaluate(async (listingMap: Record<string, any>) => {
        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
        const locales = ['en', 'de', 'fr', 'it', 'es', 'ja'];
        const filledLocales: string[] = [];

        for (const loc of locales) {
          const content = listingMap[loc] || (loc === 'ja' ? listingMap['jp'] : null) || listingMap['en'];
          if (!content) continue;

          // Expand locale tab
          const tabBtn = document.querySelector(`button[aria-controls="${loc}"], #${loc}-header button, [id="${loc}-header"] button`) as HTMLElement;
          if (tabBtn) {
            if (tabBtn.getAttribute('aria-expanded') !== 'true') {
              tabBtn.click();
              await sleep(300);
            }
          }

          const setVal = (fieldKey: string, val: string) => {
            if (!val) return;
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
              input.value = val;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          };

          setVal('brandName', content.brand || '');
          setVal('title', content.title || '');
          setVal('featureBullet1', content.bullet1 || content.bullet_1 || '');
          setVal('featureBullet2', content.bullet2 || content.bullet_2 || '');
          setVal('description', content.description || '');

          filledLocales.push(loc.toUpperCase());
          await sleep(150);
        }

        return { success: true, filledLocales };
      }, listings);

      this.log(`✅ Listings für Sprachen [${fillResult.filledLocales.join(', ')}] eingetragen!`, 'Listings fertig ✓', 90, 100);

      if (this.abortRequested) throw new Error('Upload vom Benutzer abgebrochen.');

      // 9. Final Action: Save Draft vs. Live Publish
      if (mode === 'publish') {
        this.log(`🚀 Klicke 'Publish' Button für Live-Veröffentlichung...`, 'Veröffentliche...', 95, 100);
        const submitBtn = await page.waitForSelector('#submit-button:not([disabled])', { timeout: 20000 });
        if (!submitBtn) throw new Error('Publish-Button nicht gefunden oder deaktiviert.');
        await submitBtn.click();

        this.log(`⏳ Warte auf Bestätigungs-Modal...`, 'Bestätige Publish...');
        const confirmBtn = await page.waitForSelector('.modal-footer .btn-primary.btn-submit, button.btn-submit', { timeout: 15000 });
        if (!confirmBtn) throw new Error('Bestätigungs-Button im Publish-Modal nicht gefunden.');
        await confirmBtn.click();

        this.log(`⏳ Warte auf finale Amazon-Bestätigung (#redirect-manage)...`, 'Warte auf Bestätigung...');
        await page.waitForSelector('#redirect-manage, a[href*="/manage"]', { timeout: 60000 });
        this.log(`🎉 Design erfolgreich auf Amazon Merch veröffentlicht!`, 'Erfolgreich veröffentlicht ✓', 100, 100);
      } else {
        this.log(`💾 Klicke 'Save Draft' Button für Entwurf-Speicherung...`, 'Speichere Entwurf...', 95, 100);
        const draftBtn = await page.waitForSelector('#draft-button, #save-as-draft-button, button[id*="draft"]', { timeout: 20000 });
        if (!draftBtn) throw new Error('Draft-Button nicht gefunden.');
        await draftBtn.click();
        await page.waitForTimeout(3000);
        this.log(`🎉 Design sicher als Entwurf in Amazon Merch gespeichert!`, 'Entwurf gespeichert ✓', 100, 100);
      }

      // 10. Complete Queue Item
      QueueService.updateItemStatus(item.id, 'COMPLETED');
      QueueService.rebalanceQueue();
      this.isUploading = false;
      this.currentStep = 'Abgeschlossen ✓';
      this.stepIndex = 100;
      this.broadcastStatus();

    } catch (err: any) {
      const errorMsg = err.message || 'Unbekannter Fehler während des Uploads';
      this.log(`❌ Upload Fehler: ${errorMsg}`, `Fehler: ${errorMsg}`);
      QueueService.updateItemStatus(item.id, 'ERROR', errorMsg);
      this.isUploading = false;
      this.broadcastStatus();
    }
  }
}
