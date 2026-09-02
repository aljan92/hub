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

      // Prevent esbuild/tsx __name helper ReferenceError in browser context
      await page.evaluate('window.__name = window.__name || ((fn) => fn);');

      const scannedCatalogRaw = await page.evaluate(async () => {
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const catalog: Record<string, {
          id: string;
          name: string;
          marketplaces: string[];
          fits: string[];
          colorType: 'swatches' | 'hex' | 'none';
          colorDiscoveryStatus: 'SUCCESS' | 'FAILED';
          colors: string[];
          amazonSortOrder: number;
          presetHexColors?: string[];
        }> = {};

        const knownMarkets = ['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'JP'];
        const productOrderList: string[] = [];

        // Extract from Checkboxes
        const oldCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"][id^="checkbox-"]'));
        if (oldCheckboxes.length > 0) {
          oldCheckboxes.forEach(cb => {
            const parts = cb.id.replace('checkbox-', '').split('-');
            if (parts.length >= 2) {
              const marketplace = parts.pop()!;
              const productId = parts.join('-');
              if (!productOrderList.includes(productId)) {
                productOrderList.push(productId);
              }
              if (!catalog[productId]) {
                const formattedName = productId.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                catalog[productId] = { id: productId, name: formattedName, marketplaces: [], fits: [], colorType: 'none', colorDiscoveryStatus: 'FAILED', colors: [], amazonSortOrder: productOrderList.indexOf(productId) };
              }
              if (!catalog[productId].marketplaces.includes(marketplace)) {
                catalog[productId].marketplaces.push(marketplace);
              }
            }
          });
        } else {
          // FlowCheckbox (Angular) - Processed in strict DOM top-to-bottom order
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
              if (!productOrderList.includes(productId)) {
                productOrderList.push(productId);
              }
              if (!catalog[productId]) {
                const formattedName = productId.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                catalog[productId] = { id: productId, name: formattedName, marketplaces: [], fits: [], colorType: 'none', colorDiscoveryStatus: 'FAILED', colors: [], amazonSortOrder: productOrderList.indexOf(productId) };
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

        // 7. Sequentially open each product card and discover colors/fits directly from the expanded product-editor
        for (const amazonKey of productOrderList) {
          const cardId = `${amazonKey}-card`;
          const card = document.getElementById(cardId) || document.querySelector(`[id*="${amazonKey}-card"]`);
          if (!card) {
            catalog[amazonKey].colorDiscoveryStatus = 'FAILED';
            continue;
          }

          // Scroll card into view
          card.scrollIntoView({ behavior: 'auto', block: 'center' });
          await sleep(150);

          // Find edit details button in card
          const editBtn = (card.querySelector('.edit-button, button.btn-edit, [class*="edit"]')
            || Array.from(card.querySelectorAll('button')).find(b => (b.textContent || '').trim().toLowerCase().includes('edit'))) as HTMLElement | null;

          if (!editBtn) {
            catalog[amazonKey].colorDiscoveryStatus = 'FAILED';
            continue;
          }

          // Click to expand editor
          editBtn.click();

          // Wait for this card's product-editor to expand
          const cardRect = card.getBoundingClientRect();
          let activeEditor: HTMLElement | null = null;

          for (let attempt = 0; attempt < 25; attempt++) {
            await sleep(120);
            const eds = Array.from(document.querySelectorAll('product-editor, .product-editor')) as HTMLElement[];
            const found = eds.find(ed => {
              const r = ed.getBoundingClientRect();
              return ed.offsetHeight > 50 && r.top >= cardRect.top - 50;
            });
            if (found) {
              activeEditor = found;
              break;
            }
          }

          if (!activeEditor) {
            catalog[amazonKey].colorDiscoveryStatus = 'FAILED';
            continue;
          }

          // A. Header title from editor if available
          const headerTitle = activeEditor.querySelector('h2, h3, h4, .editor-title, .product-title, .title')?.textContent?.trim();
          if (headerTitle && headerTitle.length > 2) {
            catalog[amazonKey].name = headerTitle;
          }

          // B. Fit Types
          const fitElements = Array.from(activeEditor.querySelectorAll('flowcheckbox, input[type="checkbox"]'));
          const detectedFits: string[] = [];
          for (const fe of fitElements) {
            const labelText = (fe.textContent || fe.closest('label')?.textContent || fe.getAttribute('aria-label') || '').toLowerCase().trim();
            if (labelText.includes('men') && !labelText.includes('women')) detectedFits.push('men');
            else if (labelText.includes('women')) detectedFits.push('women');
            else if (labelText.includes('youth') || labelText.includes('kids')) detectedFits.push('youth');
            else if (labelText.includes('girls')) detectedFits.push('girls');
            else if (labelText.includes('unisex') || labelText.includes('adult') || labelText.includes('standard')) detectedFits.push('standard');
          }
          catalog[amazonKey].fits = Array.from(new Set(detectedFits));

          // C. Swatches (<colorcheckbox>)
          const colorCheckboxes = Array.from(activeEditor.querySelectorAll('colorcheckbox'));
          const detectedColors: string[] = [];
          for (const cb of colorCheckboxes) {
            let colorId = '';
            const m1 = (cb.className || '').match(/([a-z0-9_]+)-checkbox/i);
            if (m1 && !['color', 'flow', 'men', 'women', 'youth', 'girls', 'guides', 'wizzy'].includes(m1[1].toLowerCase())) {
              colorId = m1[1].toLowerCase();
            }

            const innerSpan = cb.querySelector('span.color-checkbox');
            const m2 = innerSpan ? (innerSpan.className || '').match(/checkbox-([a-z0-9_]+)/i) : null;
            if (!colorId && m2 && !['color', 'flow', 'men', 'women', 'youth', 'girls', 'guides', 'wizzy'].includes(m2[1].toLowerCase())) {
              colorId = m2[1].toLowerCase();
            }

            if (colorId && !detectedColors.includes(colorId)) {
              detectedColors.push(colorId);
            }
          }

          // D. Custom Color Picker / Hex Mode
          const pickerBtn = activeEditor.querySelector('#color-btn, button[id*="color-btn"], .color-picker-button, .background-color-picker-button, button.color-btn, [class*="picker"]');
          const directHex = activeEditor.querySelector('input[type="text"][id*="hex"], input[placeholder*="Hex"], input[type="color"]');

          // E. Close editor by clicking editBtn again
          editBtn.click();
          await sleep(200);

          // F. Determine exact colorType and colorDiscoveryStatus
          if (detectedColors.length > 0) {
            catalog[amazonKey].colorType = 'swatches';
            catalog[amazonKey].colors = detectedColors;
            catalog[amazonKey].colorDiscoveryStatus = 'SUCCESS';
          } else if (pickerBtn || directHex) {
            catalog[amazonKey].colorType = 'hex';
            catalog[amazonKey].colors = [];
            catalog[amazonKey].colorDiscoveryStatus = 'SUCCESS';
            catalog[amazonKey].presetHexColors = [
              "#840A08", "#C70010", "#F36900", "#FEC600", "#01B62F", "#1C8C46", 
              "#37602B", "#1AB7EA", "#002BB6", "#5C2D91", "#E0218A", "#E9CDDB", 
              "#7B4A1B", "#979797", "#FFFFFF", "#000000"
            ];
          } else {
            catalog[amazonKey].colorType = 'none';
            catalog[amazonKey].colors = [];
            catalog[amazonKey].colorDiscoveryStatus = 'SUCCESS';
          }
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
        const colorMode: ColorMode = item.colorType === 'hex' ? 'customPicker' : (item.colorType === 'swatches' ? 'predefined' : 'none');

        const colorDefs: MerchColorDef[] = (item.colors || []).map(cid => ({
          id: cid,
          displayName: cid.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        }));

        const fitDefs: MerchFitTypeDef[] = (item.fits || []).map(fid => ({
          id: fid,
          displayName: fid.charAt(0).toUpperCase() + fid.slice(1)
        }));

        const amazonSort = item.amazonSortOrder ?? index;

        return {
          id,
          displayName: item.name || id.replace(/_/g, ' '),
          colorMode,
          colorDiscoveryStatus: item.colorDiscoveryStatus,
          colors: colorDefs,
          fitTypes: fitDefs,
          availableMarketplaces: item.marketplaces.length > 0 ? item.marketplaces : ['US'],
          sortOrder: index,
          amazonSortOrder: amazonSort,
          amazon: {
            key: id,
            cardId: `${id}-card`,
            checkboxClass: id,
            sortOrder: amazonSort
          },
          available: true,
          lastSeenAt: nowIso,
          presetHexColors: item.presetHexColors,
          lastUpdated: nowIso
        };
      });

      // VALIDATION GATE: Prevent systemic scan failures from overwriting catalog
      const totalProducts = products.length;
      const productsWithSwatches = products.filter(p => p.colors && p.colors.length > 0).length;
      const productsWithPicker = products.filter(p => p.colorMode === 'customPicker').length;
      const totalSwatches = products.reduce((acc, p) => acc + (p.colors?.length || 0), 0);

      this.addLog(`📊 Scan-Ergebnis: ${totalProducts} Produkte, ${productsWithSwatches} mit Swatches (${totalSwatches} Swatches gesamt), ${productsWithPicker} mit Color-Picker.`);

      if (totalProducts >= 5 && productsWithSwatches === 0 && productsWithPicker === 0) {
        this.addLog(`🚨 SYSTEMISCHER SCAN-FEHLER: 0 Farben und 0 Picker bei ${totalProducts} Produkten entdeckt! Breche ab zum Schutz der Katalogdaten.`, 'error');
        throw new Error(`Color Discovery Validierungsfehler: 0 Farben und 0 Picker bei ${totalProducts} Produkten entdeckt. Vorherige Daten wurden geschützt.`);
      }

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
