import { BrowserSessionService } from './browserSessionService';
import { ProductCatalogService, MerchProduct, MerchMarketplace, MerchColorDef, MerchFitTypeDef } from './productCatalogService';
import { SyncEngine } from './syncEngine';

export interface ProductScanLog {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

export interface ProductScannerState {
  isScanning: boolean;
  scanProgress: string;
  scanError: string | null;
  lastScanDate: string | null;
  nextScheduledScan: string | null;
  logs: ProductScanLog[];
}

export class ProductScannerService {
  private static isScanning = false;
  private static scanProgress = 'Bereit';
  private static scanError: string | null = null;
  private static logs: ProductScanLog[] = [];
  private static nextScheduledScan: string | null = null;
  private static scheduledTimer: NodeJS.Timeout | null = null;
  private static isInitialized = false;

  public static getState(): ProductScannerState {
    const stats = ProductCatalogService.getStats();
    return {
      isScanning: this.isScanning,
      scanProgress: this.scanProgress,
      scanError: this.scanError,
      lastScanDate: stats.lastScanDate,
      nextScheduledScan: this.nextScheduledScan,
      logs: this.logs.slice(-50)
    };
  }

  public static addLog(message: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') {
    const entry: ProductScanLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      message,
      type
    };
    this.logs.push(entry);
    if (this.logs.length > 200) {
      this.logs.shift();
    }
    console.log(`[ProductScanner] [${type.toUpperCase()}] ${message}`);
  }

  /**
   * Initialize scanner on system startup
   */
  public static init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Load initial catalog
    ProductCatalogService.loadCatalog();
    const stats = ProductCatalogService.getStats();

    this.addLog(`Product Scanner initialisiert (${stats.totalProducts} Produkte im Katalog, ${stats.totalSlots} Slots).`);

    // Check if we should trigger an immediate scan (e.g. if catalog is empty)
    if (stats.totalProducts === 0) {
      this.addLog('Produktdatenbank ist leer. Plane initialen Scan in 30 Sekunden...', 'warn');
      setTimeout(() => {
        this.startScan().catch(err => {
          console.error('[ProductScanner] Initial scan failed:', err);
        });
      }, 30000);
    } else {
      this.scheduleNextRandomScan();
    }
  }

  /**
   * Schedule the next scan randomly between 12 and 18 hours
   */
  private static scheduleNextRandomScan() {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    // Random between 12 and 18 hours (in milliseconds)
    const minHours = 12;
    const maxHours = 18;
    const randomHours = minHours + Math.random() * (maxHours - minHours);
    const delayMs = Math.round(randomHours * 60 * 60 * 1000);
    
    const nextDate = new Date(Date.now() + delayMs);
    this.nextScheduledScan = nextDate.toISOString();

    this.addLog(`Nächster automatischer Produkt-Scan geplant in ${randomHours.toFixed(1)}h (${nextDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr).`);

    this.scheduledTimer = setTimeout(() => {
      this.startScan().catch(err => {
        console.error('[ProductScanner] Scheduled scan failed:', err);
      });
    }, delayMs);
  }

  /**
   * Clear dynamic database and immediately trigger a fresh scan
   */
  public static async clearAndRescan(): Promise<{ success: boolean; message: string }> {
    this.addLog('Produktdatenbank wird geleert...', 'warn');
    ProductCatalogService.clearCatalog();

    if (this.isScanning) {
      return { success: true, message: 'Datenbank geleert. Scan läuft bereits.' };
    }

    // Trigger immediate scan asynchronously
    setTimeout(() => {
      this.startScan().catch(err => {
        console.error('[ProductScanner] Rescan after clear failed:', err);
      });
    }, 100);

    return { success: true, message: 'Datenbank geleert. Frischer Scan wurde sofort gestartet.' };
  }

  /**
   * Start scan on Amazon Merch create page via Session 1
   */
  public static async startScan(): Promise<{ success: boolean; message: string }> {
    if (this.isScanning) {
      return { success: false, message: 'Ein Scan wird bereits ausgeführt.' };
    }

    this.isScanning = true;
    this.scanError = null;
    this.scanProgress = 'Initialisiere Session 1...';
    this.addLog('🚀 Starte Produkt-Datenbank-Scan via Chrome Session 1...');

    try {
      // 1. Get Session 1 (Sync & Login)
      const session = await BrowserSessionService.getSession('sync');
      if (!session || !session.page) {
        throw new Error('Chrome Session 1 konnte nicht initialisiert werden.');
      }

      const page = session.page;

      // 2. Navigate to Amazon Merch Create Page
      this.scanProgress = 'Navigiere zu merch.amazon.com/designs/new...';
      this.addLog('Navigiere zur Amazon Merch Create-Seite...');

      await page.goto('https://merch.amazon.com/designs/new', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      // 3. Wait for page stability (spinner gone, select marketplace button)
      this.scanProgress = 'Warte auf Seiten-Initialisierung...';
      await page.waitForTimeout(2000);

      // Check if logged in
      const currentUrl = page.url();
      if (currentUrl.includes('/signin') || currentUrl.includes('/ap/signin')) {
        throw new Error('Nicht bei Merch by Amazon eingeloggt. Bitte zuerst in Session 1 einloggen.');
      }

      // Wait for Angular / page components
      let pageReady = false;
      for (let i = 0; i < 20; i++) {
        const hasSelectBtn = await page.$('#select-marketplace-button-original, [id*="select-marketplace"]');
        const spinner = await page.$('nga-global-spinner');
        let spinnerVisible = false;
        if (spinner) {
          spinnerVisible = await spinner.isVisible().catch(() => false);
        }

        if (hasSelectBtn && !spinnerVisible) {
          pageReady = true;
          break;
        }
        await page.waitForTimeout(1000);
      }

      if (!pageReady) {
        this.addLog('Hinweis: Select-Button nicht sofort sichtbar. Versuche trotzdem fortzufahren...', 'warn');
      }

      // 4. Upload 500x500 Mock Design in Browser Context to unlock all product cards
      this.scanProgress = 'Prüfe Design-Upload zum Freischalten aller Produktkarten...';
      this.addLog('Erzeuge 500x500px Mock-Design zum Aktivieren der Produktkarten...');

      const uploadResult = await page.evaluate(async () => {
        try {
          const fileInput = document.querySelector('.dropzone-container input[type="file"], input[type="file"]') as HTMLInputElement | null;
          if (!fileInput) return { ok: true, reason: 'no_input' };
          if (fileInput.files && fileInput.files.length > 0) return { ok: true, reason: 'already_loaded' };

          // Create 500x500 canvas
          const canvas = document.createElement('canvas');
          canvas.width = 500;
          canvas.height = 500;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 500, 500);
          }

          const dataURL = canvas.toDataURL('image/png');
          const base64Data = dataURL.split(',')[1];
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/png' });
          const file = new File([blob], 'scanner_mock.png', { type: 'image/png' });

          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));

          return { ok: true, reason: 'uploaded' };
        } catch (e: any) {
          return { ok: false, error: e.message };
        }
      });

      this.addLog(`Mock-Upload Status: ${JSON.stringify(uploadResult)}`);
      await page.waitForTimeout(3000);

      // 5. Open Product Matrix Modal
      this.scanProgress = 'Öffne Produkt- & Marktplatz-Matrix...';
      this.addLog('Öffne Produkt- & Marktplatz-Matrix (#select-marketplace-button-original)...');

      const selectMarketplaceBtn = await page.$('#select-marketplace-button-original, [id*="select-marketplace"]');
      if (selectMarketplaceBtn) {
        await selectMarketplaceBtn.click();
        await page.waitForTimeout(2000);
      }

      // 6. Extract Catalog Matrix & Cards via DOM Script
      this.scanProgress = 'Scanne Produkt-Matrix & Marktplätze...';
      this.addLog('Scanne alle Produkt-IDs, Marktplätze und Farbvarianten...');

      const scannedCatalogRaw = await page.evaluate(async () => {
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const catalog: Record<string, {
          id: string;
          name: string;
          marketplaces: string[];
          fits: string[];
          colorType: 'swatches' | 'hex' | 'none';
          colors: string[];
          presetHexColors?: string[];
        }> = {};

        const knownMarkets = ['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'JP'];

        // Extract from Checkboxes
        const oldCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"][id^="checkbox-"]'));
        if (oldCheckboxes.length > 0) {
          oldCheckboxes.forEach(cb => {
            const parts = cb.id.replace('checkbox-', '').split('-');
            if (parts.length >= 2) {
              const marketplace = parts.pop()!;
              const productId = parts.join('-');
              if (!catalog[productId]) {
                const formattedName = productId.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                catalog[productId] = { id: productId, name: formattedName, marketplaces: [], fits: [], colorType: 'none', colors: [] };
              }
              if (!catalog[productId].marketplaces.includes(marketplace)) {
                catalog[productId].marketplaces.push(marketplace);
              }
            }
          });
        } else {
          // FlowCheckbox (Angular)
          const flowCheckboxes = Array.from(document.querySelectorAll('flowcheckbox[formcontrolname="shouldPublish"], flowcheckbox[class*="-checkbox"]'));
          flowCheckboxes.forEach(fc => {
            let identifier = '';
            for (let i = 0; i < fc.classList.length; i++) {
              const c = fc.classList[i];
              if (c.includes('-')) {
                const lastPart = c.split('-').pop();
                if (knownMarkets.includes(lastPart || '')) {
                  identifier = c;
                  break;
                }
              }
            }

            if (identifier) {
              const parts = identifier.split('-');
              const marketplace = parts.pop()!;
              const productId = parts.join('-');
              if (!catalog[productId]) {
                const formattedName = productId.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                catalog[productId] = { id: productId, name: formattedName, marketplaces: [], fits: [], colorType: 'none', colors: [] };
              }
              if (!catalog[productId].marketplaces.includes(marketplace)) {
                catalog[productId].marketplaces.push(marketplace);
              }
            }
          });
        }

        // Click "Select All" if present to expand all cards
        const selectAllBtn = document.getElementById('select-all') as HTMLButtonElement | null;
        if (selectAllBtn) {
          selectAllBtn.click();
          await sleep(1000);
        }

        // Close Modal
        const closeBtn = (document.querySelector('.modal-header .close') || document.querySelector('.close') || document.querySelector('button[aria-label="Close"]')) as HTMLElement | null;
        if (closeBtn) {
          closeBtn.click();
          await sleep(1500);
        }

        const productIds = Object.keys(catalog);

        // Iterate through each product card in DOM
        for (const productId of productIds) {
          const configSection = document.getElementById(`config-${productId}`) || document.getElementById(`${productId}-card`);
          if (!configSection) continue;

          // Expand card if collapsed
          const isExpanded = configSection.querySelector('button[aria-expanded="true"]');
          const editDetailsBtn = configSection.querySelector(`.edit-details-btn, .${productId}-edit-btn, button[aria-expanded="false"]`) as HTMLElement | null;

          if (!isExpanded && editDetailsBtn) {
            editDetailsBtn.click();
            await sleep(800);
          }

          // Header title
          const headerTitle = configSection.querySelector('.accordion-header-title, .product-title, .heading')?.textContent?.trim();
          if (headerTitle) {
            catalog[productId].name = headerTitle;
          }

          // Find mounted editor container
          let inputContainer: Element = configSection;
          const allEditors = Array.from(document.querySelectorAll('.product-editor, product-editor, .product-config-panel'));
          const cardRect = configSection.getBoundingClientRect();
          const validEditors = allEditors.filter(ed => {
            const edRect = ed.getBoundingClientRect();
            return edRect.top >= cardRect.bottom - 50 && ed.innerHTML.length > 20;
          });

          if (validEditors.length > 0) {
            inputContainer = validEditors[0];
          } else if (allEditors.length > 0) {
            inputContainer = allEditors[allEditors.length - 1];
          }

          // 1. Scrape Fits
          const fitInputs = Array.from(inputContainer.querySelectorAll('input[name="fitType"], input[id*="fitType"], flowcheckbox[class*="-checkbox"]'));
          fitInputs.forEach(el => {
            let fitVal = '';
            if (el.tagName.toLowerCase() === 'input') {
              fitVal = (el as HTMLInputElement).value.toLowerCase();
            } else {
              const match = el.className.match(/([a-z]+)-checkbox/i);
              if (match) fitVal = match[1].toLowerCase();
            }
            if (fitVal && !catalog[productId].fits.includes(fitVal)) {
              catalog[productId].fits.push(fitVal);
            }
          });

          const validFits = catalog[productId].fits.filter(f => ['men', 'women', 'youth', 'girls'].includes(f));
          if (validFits.length >= 2 || productId.includes('TSHIRT') || productId.includes('VNECK')) {
            catalog[productId].fits = validFits;
          } else {
            catalog[productId].fits = [];
          }

          // 2. Accessories -> Force Hex Color Picker
          const isAccessory = ['POP_SOCKET', 'PHONE_CASE_APPLE_IPHONE', 'GLANCE_CASE_SAMSUNG_GALAXY', 'PHONE_CASE_SAMSUNG_GALAXY', 'TOTE_BAG', 'THROW_PILLOW'].includes(productId);
          if (isAccessory) {
            catalog[productId].colorType = 'hex';
            catalog[productId].presetHexColors = [
              "#840A08", "#C70010", "#F36900", "#FEC600", "#01B62F", "#1C8C46", 
              "#37602B", "#1AB7EA", "#002BB6", "#5C2D91", "#E0218A", "#E9CDDB", 
              "#7B4A1B", "#979797", "#FFFFFF", "#000000"
            ];
          }

          // 3. Predefined Swatch Colors
          if (catalog[productId].colorType !== 'hex') {
            const colorSwatches = Array.from(inputContainer.querySelectorAll('input[type="checkbox"][id*="color-"]')) as HTMLInputElement[];
            if (colorSwatches.length > 0) {
              catalog[productId].colorType = 'swatches';
              colorSwatches.forEach(input => {
                const colorVal = input.value.toLowerCase();
                if (!catalog[productId].colors.includes(colorVal)) {
                  catalog[productId].colors.push(colorVal);
                }
              });
            } else {
              catalog[productId].colorType = 'swatches';
              const colorNodes = Array.from(inputContainer.querySelectorAll('colorcheckbox, .color-checkbox, [title], [aria-label], img[alt]'));
              colorNodes.forEach(el => {
                let val = '';
                const match1 = (el.className || '').match(/checkbox-([a-z_]+)/i);
                const match2 = (el.className || '').match(/([a-z_]+)-checkbox/i);
                if (match1) {
                  val = match1[1].toLowerCase();
                } else if (match2 && !['color', 'flow', 'men', 'women', 'youth', 'girls', 'guides', 'wizzy'].includes(match2[1].toLowerCase())) {
                  val = match2[1].toLowerCase();
                } else {
                  val = (el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('alt'))?.toLowerCase().trim() || '';
                }

                if (val) {
                  const cleanVal = val.replace(/ /g, '_');
                  const ignoreList = ['color', 'select_colors:', 'choose_fit_types:', 'drag_and_drop_artwork_here', 'men', 'women', 'youth', 'girls', 'front', 'back', 'guides', 'wizzy'];
                  if (!ignoreList.includes(cleanVal) && !catalog[productId].colors.includes(cleanVal)) {
                    catalog[productId].colors.push(cleanVal);
                  }
                }
              });

              if (catalog[productId].colors.length === 0) {
                const hexInput = inputContainer.querySelector('input[type="text"][id*="hex"], input[type="text"][placeholder*="Hex"]');
                if (hexInput) {
                  catalog[productId].colorType = 'hex';
                }
              }
            }
          }

          await sleep(100);
        }

        return catalog;
      });

      const productKeys = Object.keys(scannedCatalogRaw);
      this.addLog(`DOM-Scan abgeschlossen: ${productKeys.length} Produkte extrahiert.`);

      if (productKeys.length === 0) {
        throw new Error('Keine Produkte in der Amazon Merch DOM-Matrix gefunden. Ist der Account freigeschaltet?');
      }

      // Convert scanned raw data to MerchProduct array
      const nowIso = new Date().toISOString();
      const products: MerchProduct[] = productKeys.map((id, index) => {
        const item = scannedCatalogRaw[id];
        const colorMode = item.colorType === 'hex' ? 'customPicker' : 'predefined';

        const colorDefs: MerchColorDef[] = (item.colors || []).map(cid => ({
          id: cid,
          displayName: cid.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        }));

        const fitDefs: MerchFitTypeDef[] = (item.fits || []).map(fid => ({
          id: fid,
          displayName: fid.charAt(0).toUpperCase() + fid.slice(1)
        }));

        return {
          id,
          displayName: item.name || id.replace(/_/g, ' '),
          colorMode,
          colors: colorDefs,
          fitTypes: fitDefs,
          availableMarketplaces: item.marketplaces.length > 0 ? item.marketplaces : ['US'],
          sortOrder: index,
          presetHexColors: item.presetHexColors,
          lastUpdated: nowIso
        };
      });

      // Save to ProductCatalogService
      ProductCatalogService.saveCatalog({
        products,
        marketplaces: ProductCatalogService.getDefaultMarketplaces(),
        lastScanDate: nowIso
      });

      const finalStats = ProductCatalogService.getStats();
      this.scanProgress = 'Scan erfolgreich abgeschlossen!';
      this.addLog(`✅ Scan erfolgreich: ${finalStats.totalProducts} Produkte, ${finalStats.totalSlots} Slots in ./data/product_catalog.json gespeichert.`, 'success');

      // Schedule next random scan (12 to 18h)
      this.scheduleNextRandomScan();

      return {
        success: true,
        message: `Scan erfolgreich abgeschlossen (${finalStats.totalProducts} Produkte, ${finalStats.totalSlots} Slots).`
      };

    } catch (err: any) {
      this.scanError = err.message || 'Unbekannter Scan-Fehler';
      this.scanProgress = `Fehler: ${this.scanError}`;
      this.addLog(`❌ Scan-Fehler: ${this.scanError}`, 'error');
      return { success: false, message: this.scanError };
    } finally {
      this.isScanning = false;
    }
  }
}
