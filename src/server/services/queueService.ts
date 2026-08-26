import fs from 'fs';
import path from 'path';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
import { loadSettings, saveSettings } from './settingsService';

export type QueueItemStatus = 'SCHEDULED_TODAY' | 'WAITING_FOR_SLOTS' | 'UPLOADING' | 'COMPLETED' | 'ERROR';

export interface ListingLanguageContent {
  brand?: string;
  title?: string;
  bullet1?: string;
  bullet2?: string;
  description?: string;
}

export interface QueueItem {
  id: string;
  taskId: string;
  designTitle: string;
  niche: string;
  brand: string;
  title: string;
  bullet1: string;
  bullet2: string;
  description: string;
  listings?: Record<string, ListingLanguageContent>; // e.g. { en: {...}, de: {...}, fr: {...}, es: {...}, it: {...}, jp: {...} }
  fitTypes?: string[];                               // e.g. ['men', 'women', 'youth']
  avoidColor?: 'white' | 'black' | 'none';          // e.g. 'white' or 'black'
  customBackgroundColor?: string;                    // e.g. '#000000'
  imagePath: string;
  pngPath: string;
  addedAt: string;
  status: QueueItemStatus;
  isLocked: boolean; // Hero-Design Lock: protects from dynamic slot dropping
  allocatedSlots: number;
  totalBaseSlots: number;
  activeProductsMap: Record<string, string[]>; // productId -> array of active marketplaces (e.g. ['US', 'DE', 'GB'])
  droppedSlotsMap: Record<string, string[]>;   // productId -> array of dropped marketplaces (e.g. ['JP', 'ES', 'IT'])
  tmBlockedProductIds: string[];              // Product IDs blocked by TM
  errorMessage?: string;
  sortOrder: number;
  uploadedAt?: string;
  lastUploadAttempt?: string;
}

export interface QueueState {
  items: QueueItem[];
  freeDailySlots: number;
  usedSlotsToday: number;
  totalDailySlots: number;
  scheduledSlotsToday: number;
  uploadScheduleTime: string; // e.g. "04:00" or "off"
  maxDropPerDesign: number;
  autoBalance: boolean;
  maxDroppableCapacity: number;
}

// Strict drop sequence for non-US marketplaces within a droppable product
const NON_US_DROP_ORDER = ['JP', 'ES', 'IT', 'FR', 'DE', 'GB'];

export class QueueService {
  private static queueFilePath = path.resolve(process.cwd(), 'data', 'upload_queue.json');
  private static tasksLogPath = path.resolve(process.cwd(), 'data', 'tasks_log.json');
  private static items: QueueItem[] = [];
  private static isLoaded = false;
  private static dailySlotsInfo = { free: 200, used: 0, total: 200 };

  private static ensureLoaded() {
    if (this.isLoaded) return;
    this.loadQueue();
    this.isLoaded = true;
  }

  /**
   * Load queue from ./data/upload_queue.json with auto-enrichment from tasks_log.json
   */
  public static loadQueue(): QueueItem[] {
    try {
      if (fs.existsSync(this.queueFilePath)) {
        const raw = fs.readFileSync(this.queueFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;

          // Auto-enrich any items that might be missing full multi-language listings
          this.enrichListingsFromTasksLog();
          return this.items;
        }
      }
    } catch (err: any) {
      console.error('[QueueService] Error reading upload_queue.json:', err.message);
    }
    this.items = [];
    return this.items;
  }

  /**
   * Enrich items with full multi-language listings from tasks_log.json if missing
   */
  private static enrichListingsFromTasksLog() {
    try {
      if (!fs.existsSync(this.tasksLogPath)) return;
      const tasksRaw = fs.readFileSync(this.tasksLogPath, 'utf-8');
      const tasks = JSON.parse(tasksRaw);
      if (!Array.isArray(tasks)) return;

      const tasksMap = new Map(tasks.map((t: any) => [t.id, t]));
      let hasChanges = false;

      const cleanStr = (txt: string) => {
        if (!txt) return '';
        return txt
          .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\u275D\u275E]/g, '"')
          .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\u02BB\u275B\u275C]/g, "'")
          .replace(/[\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
          .replace(/\u2026/g, '...')
          .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
          .replace(/[^ -)+-\u00ad\u00af-\u00ff\u1e9e\u20ac\u017d\u0160\u0161\u017e\u0152\u0153\u0178\u4e00-\u9fa0\u3041-\u3093\u3094\u30a1-\u30f4\u30fc\u3005\u3006\u3024\uff41-\uff5a\uff21-\uff3a\uff10-\uff19\u2460-\u2473\u3001-\uff3d\u300c\u300d\u00b0\u2032\u2033\u3000\u2013\u201c\u201d\u2018\u2019\u2026]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };

      for (const item of this.items) {
        // Always sanitize root fields
        if (item.title) item.title = cleanStr(item.title);
        if (item.brand) item.brand = cleanStr(item.brand);
        if (item.bullet1) item.bullet1 = cleanStr(item.bullet1);
        if (item.bullet2) item.bullet2 = cleanStr(item.bullet2);
        if (item.description) item.description = cleanStr(item.description);

        if (item.listings) {
          for (const langObj of Object.values(item.listings)) {
            if (langObj && typeof langObj === 'object') {
              if (langObj.title) langObj.title = cleanStr(langObj.title);
              if (langObj.brand) langObj.brand = cleanStr(langObj.brand);
              if (langObj.bullet1) langObj.bullet1 = cleanStr(langObj.bullet1);
              if (langObj.bullet2) langObj.bullet2 = cleanStr(langObj.bullet2);
              if (langObj.description) langObj.description = cleanStr(langObj.description);
            }
          }
        }

        const task = tasksMap.get(item.taskId);
        if (task) {
          const listing = task.listingResult || task.trademarkRefineResult || {};
          const enListing = listing.en || (listing.title || listing.brand ? listing : {});
          
          if (!item.brand || item.brand === '—') item.brand = cleanStr(enListing.brand || task.payload?.brand || '');
          if (!item.title || item.title === 'Neues Design') item.title = cleanStr(enListing.title || task.payload?.title || task.payload?.quote || '');
          if (!item.bullet1) item.bullet1 = cleanStr(enListing.bullet1 || enListing.bullet_1 || '');
          if (!item.bullet2) item.bullet2 = cleanStr(enListing.bullet2 || enListing.bullet_2 || '');
          if (!item.description) item.description = cleanStr(enListing.description || '');
          if (!item.niche && task.payload?.niche) item.niche = task.payload.niche;

          // Build multi-language listings map
          if (!item.listings || Object.keys(item.listings).length === 0) {
            const listings: Record<string, ListingLanguageContent> = {};
            if (typeof listing === 'object') {
              for (const [key, val] of Object.entries(listing)) {
                if (val && typeof val === 'object' && !Array.isArray(val) && !key.startsWith('_')) {
                  const langContent = val as any;
                  listings[key.toLowerCase()] = {
                    brand: cleanStr(langContent.brand || item.brand),
                    title: cleanStr(langContent.title || item.title),
                    bullet1: cleanStr(langContent.bullet1 || langContent.bullet_1 || ''),
                    bullet2: cleanStr(langContent.bullet2 || langContent.bullet_2 || ''),
                    description: cleanStr(langContent.description || '')
                  };
                }
              }
            }
            if (!listings.en && (item.title || item.brand)) {
              listings.en = {
                brand: cleanStr(item.brand),
                title: cleanStr(item.title),
                bullet1: cleanStr(item.bullet1),
                bullet2: cleanStr(item.bullet2),
                description: cleanStr(item.description)
              };
            }
            item.listings = listings;
            hasChanges = true;
          }

          // Fit types & color rules from Question Phase
          if (!item.fitTypes || item.fitTypes.length === 0) {
            const audience = (task.customAnswers?.audience || task.payload?.audience || 'Men, Women, Youth').toLowerCase();
            const types: string[] = [];
            if (audience.includes('men') || audience.includes('männer') || audience.includes('herren')) types.push('men');
            if (audience.includes('women') || audience.includes('frauen') || audience.includes('damen')) types.push('women');
            if (audience.includes('youth') || audience.includes('kids') || audience.includes('kinder') || audience.includes('jugend')) types.push('youth');
            item.fitTypes = types.length > 0 ? types : ['men', 'women', 'youth'];
            hasChanges = true;
          }

          if (!item.avoidColor) {
            const avoid = (task.customAnswers?.avoidColor || task.payload?.avoidColor || '').toLowerCase();
            if (avoid.includes('white') || avoid.includes('weiß')) item.avoidColor = 'white';
            else if (avoid.includes('black') || avoid.includes('schwarz')) item.avoidColor = 'black';
            else item.avoidColor = 'none';
            hasChanges = true;
          }

          if (!item.customBackgroundColor && task.customAnswers?.reuseBackground) {
            item.customBackgroundColor = task.customAnswers.reuseBackground;
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        fs.writeFileSync(this.queueFilePath, JSON.stringify(this.items, null, 2), 'utf-8');
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * Save queue to ./data/upload_queue.json
   */
  public static saveQueue(): QueueItem[] {
    this.ensureLoaded();
    try {
      const dataDir = path.dirname(this.queueFilePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(this.queueFilePath, JSON.stringify(this.items, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[QueueService] Error writing upload_queue.json:', err.message);
    }
    return this.items;
  }

  /**
   * Update daily slot info from Amazon Merch metadata
   */
  public static updateDailySlots(free: number, used: number, total: number) {
    this.dailySlotsInfo = { free: Math.max(0, free), used, total };
    const settings = loadSettings();
    if (settings.queueAutoBalance) {
      this.rebalanceQueue();
    }
  }

  /**
   * Get complete queue state and metrics
   */
  public static getState(): QueueState {
    this.ensureLoaded();
    const settings = loadSettings();
    const maxDroppableCapacity = ProductCatalogService.calculateMaxDroppableSlotsCount();

    // Calculate total slots scheduled for today
    const scheduledItems = this.items.filter(i => i.status === 'SCHEDULED_TODAY' || i.status === 'UPLOADING');
    const scheduledSlotsToday = scheduledItems.reduce((sum, item) => sum + (item.allocatedSlots || 0), 0);

    return {
      items: this.items,
      freeDailySlots: this.dailySlotsInfo.free,
      usedSlotsToday: this.dailySlotsInfo.used,
      totalDailySlots: this.dailySlotsInfo.total,
      scheduledSlotsToday,
      uploadScheduleTime: settings.queueUploadScheduleTime || 'off',
      maxDropPerDesign: settings.queueMaxDropPerDesign ?? 10,
      autoBalance: settings.queueAutoBalance ?? true,
      maxDroppableCapacity
    };
  }

  /**
   * Add a completed task / design into the upload queue
   */
  public static enqueueDesign(item: {
    taskId: string;
    designTitle: string;
    niche: string;
    brand: string;
    title: string;
    bullet1: string;
    bullet2: string;
    description: string;
    listings?: Record<string, ListingLanguageContent>;
    fitTypes?: string[];
    avoidColor?: 'white' | 'black' | 'none';
    customBackgroundColor?: string;
    imagePath: string;
    pngPath: string;
    tmBlockedProductIds?: string[];
  }): QueueItem {
    this.ensureLoaded();

    // Check if already in queue
    const existing = this.items.find(i => i.taskId === item.taskId);
    if (existing) {
      if (item.listings) existing.listings = item.listings;
      if (item.brand) existing.brand = item.brand;
      if (item.title) existing.title = item.title;
      if (item.bullet1) existing.bullet1 = item.bullet1;
      if (item.bullet2) existing.bullet2 = item.bullet2;
      if (item.description) existing.description = item.description;
      if (item.fitTypes) existing.fitTypes = item.fitTypes;
      if (item.avoidColor) existing.avoidColor = item.avoidColor;
      if (item.customBackgroundColor) existing.customBackgroundColor = item.customBackgroundColor;
      this.saveQueue();
      return existing;
    }

    const catalog = ProductCatalogService.getCatalog();
    const tmBlocked = new Set((item.tmBlockedProductIds || []).map(id => id.toUpperCase()));

    // Build initial active products map (all available products except TM-blocked)
    const activeProductsMap: Record<string, string[]> = {};
    let totalBaseSlots = 0;

    for (const prod of catalog.products) {
      if (tmBlocked.has(prod.id.toUpperCase())) {
        continue; // TM-blocked products are completely excluded
      }
      const mps = Array.isArray(prod.availableMarketplaces) ? [...prod.availableMarketplaces] : ['US'];
      activeProductsMap[prod.id] = mps;
      totalBaseSlots += mps.length;
    }

    const newItem: QueueItem = {
      id: 'q_' + Math.random().toString(36).substring(2, 9),
      taskId: item.taskId,
      designTitle: item.designTitle || item.title || 'Neues Design',
      niche: item.niche || '',
      brand: item.brand,
      title: item.title,
      bullet1: item.bullet1,
      bullet2: item.bullet2,
      description: item.description,
      listings: item.listings || {
        en: {
          brand: item.brand,
          title: item.title,
          bullet1: item.bullet1,
          bullet2: item.bullet2,
          description: item.description
        }
      },
      fitTypes: item.fitTypes || ['men', 'women', 'youth'],
      avoidColor: item.avoidColor || 'none',
      customBackgroundColor: item.customBackgroundColor,
      imagePath: item.imagePath,
      pngPath: item.pngPath,
      addedAt: new Date().toISOString(),
      status: 'WAITING_FOR_SLOTS',
      isLocked: false,
      allocatedSlots: totalBaseSlots,
      totalBaseSlots,
      activeProductsMap,
      droppedSlotsMap: {},
      tmBlockedProductIds: item.tmBlockedProductIds || [],
      sortOrder: this.items.length
    };

    this.items.push(newItem);
    this.saveQueue();

    // Auto-rebalance immediately
    this.rebalanceQueue();

    return newItem;
  }

  /**
   * Update item status during upload (UPLOADING, COMPLETED, ERROR)
   */
  public static updateItemStatus(queueId: string, status: QueueItemStatus, error?: string): QueueItem | null {
    this.ensureLoaded();
    const item = this.items.find(i => i.id === queueId);
    if (!item) return null;

    item.status = status;
    item.lastUploadAttempt = new Date().toISOString();
    if (error) {
      item.errorMessage = error;
    } else if (status === 'COMPLETED') {
      item.errorMessage = undefined;
      item.uploadedAt = new Date().toISOString();
    }
    this.saveQueue();
    return item;
  }

  /**
   * Toggle Hero-Lock on a queue item
   */
  public static toggleLock(queueId: string): QueueItem | null {
    this.ensureLoaded();
    const item = this.items.find(i => i.id === queueId);
    if (!item) return null;

    item.isLocked = !item.isLocked;
    this.saveQueue();
    this.rebalanceQueue();
    return item;
  }

  /**
   * Remove item from queue
   */
  public static removeItem(queueId: string): boolean {
    this.ensureLoaded();
    const prevLen = this.items.length;
    this.items = this.items.filter(i => i.id !== queueId);
    if (this.items.length !== prevLen) {
      this.saveQueue();
      this.rebalanceQueue();
      return true;
    }
    return false;
  }

  /**
   * Reorder items in the queue and trigger dynamic rebalance
   */
  public static reorderItems(orderedIds: string[]): QueueState {
    this.ensureLoaded();
    const idMap = new Map(this.items.map(i => [i.id, i]));
    const reordered: QueueItem[] = [];

    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      if (idMap.has(id)) {
        const item = idMap.get(id)!;
        item.sortOrder = index;
        reordered.push(item);
        idMap.delete(id);
      }
    }

    // Append any items that weren't in orderedIds
    for (const remaining of idMap.values()) {
      remaining.sortOrder = reordered.length;
      reordered.push(remaining);
    }

    this.items = reordered;
    this.saveQueue();
    return this.rebalanceQueue();
  }

  /**
   * Clear completed or all items
   */
  public static clearQueue(onlyCompleted = true) {
    this.ensureLoaded();
    if (onlyCompleted) {
      this.items = this.items.filter(i => i.status !== 'COMPLETED');
    } else {
      this.items = [];
    }
    this.saveQueue();
    this.rebalanceQueue();
  }

  /**
   * Core Mathematical Slot Balancing & Capacity Optimization Algorithm
   */
  public static rebalanceQueue(freeSlotsOverride?: number): QueueState {
    this.ensureLoaded();
    const settings = loadSettings();
    const freeDailySlots = freeSlotsOverride !== undefined ? freeSlotsOverride : this.dailySlotsInfo.free;
    const maxDrop = settings.queueMaxDropPerDesign ?? 10;
    const droppableProducts = ProductCatalogService.getDroppableProductsOrdered();

    // If queue is empty, nothing to balance
    if (this.items.length === 0) {
      return this.getState();
    }

    const pendingItems = this.items.filter(i => i.status !== 'COMPLETED' && i.status !== 'ERROR');

    // 1. Reset each item to its full TM-compliant base allocation
    const catalog = ProductCatalogService.getCatalog();
    for (const item of pendingItems) {
      const tmBlocked = new Set((item.tmBlockedProductIds || []).map(id => id.toUpperCase()));
      const activeMap: Record<string, string[]> = {};
      let baseSlots = 0;

      for (const prod of catalog.products) {
        if (tmBlocked.has(prod.id.toUpperCase())) continue;
        const mps = Array.isArray(prod.availableMarketplaces) ? [...prod.availableMarketplaces] : ['US'];
        activeMap[prod.id] = mps;
        baseSlots += mps.length;
      }

      item.activeProductsMap = activeMap;
      item.droppedSlotsMap = {};
      item.totalBaseSlots = baseSlots;
      item.allocatedSlots = baseSlots;
    }

    // 2. Capacity & Smart Selection: Determine how many designs can fit today
    // Minimum slots each design requires: baseSlots - maxDrop (or baseSlots if locked)
    let accumulatedMinSlots = 0;
    const scheduledItems: QueueItem[] = [];
    const waitingItems: QueueItem[] = [];

    for (const item of pendingItems) {
      const minRequired = item.isLocked ? item.totalBaseSlots : Math.max(1, item.totalBaseSlots - maxDrop);
      if (accumulatedMinSlots + minRequired <= freeDailySlots || scheduledItems.length === 0) {
        accumulatedMinSlots += minRequired;
        scheduledItems.push(item);
        item.status = 'SCHEDULED_TODAY';
      } else {
        waitingItems.push(item);
        item.status = 'WAITING_FOR_SLOTS';
      }
    }

    // 3. Dynamic Slot Balancing across scheduled designs
    const totalRequestedSlots = scheduledItems.reduce((sum, item) => sum + item.totalBaseSlots, 0);

    if (totalRequestedSlots > freeDailySlots && scheduledItems.length > 0) {
      let slotsToDropTotal = totalRequestedSlots - freeDailySlots;
      const unlockedScheduled = scheduledItems.filter(i => !i.isLocked);

      // Track drops per item
      const dropsPerItem: Record<string, number> = {};
      unlockedScheduled.forEach(i => { dropsPerItem[i.id] = 0; });

      // Round-robin drop allocation until total required drops are met or maxDrop is reached
      let progressMade = true;
      while (slotsToDropTotal > 0 && progressMade && unlockedScheduled.length > 0) {
        progressMade = false;
        for (const item of unlockedScheduled) {
          if (slotsToDropTotal <= 0) break;
          const currentDrops = dropsPerItem[item.id];
          if (currentDrops < maxDrop) {
            // Attempt to drop 1 slot following the hybrid cascade (Products priority -> JP->ES->IT->FR->DE->GB)
            const dropped = this.dropOneSlotFromItem(item, droppableProducts);
            if (dropped) {
              dropsPerItem[item.id]++;
              slotsToDropTotal--;
              progressMade = true;
            }
          }
        }
      }
    }

    // 4. Update allocatedSlots for all items
    for (const item of scheduledItems) {
      let total = 0;
      for (const prodId in item.activeProductsMap) {
        total += item.activeProductsMap[prodId].length;
      }
      item.allocatedSlots = total;
    }

    for (const item of waitingItems) {
      item.allocatedSlots = item.totalBaseSlots;
    }

    this.saveQueue();
    return this.getState();
  }

  /**
   * Drops exactly 1 non-US slot from an item following the strict cascade
   */
  private static dropOneSlotFromItem(item: QueueItem, droppableProducts: MerchProduct[]): boolean {
    // 1. Iterate through droppable products in user-defined priority order
    for (const prod of droppableProducts) {
      const activeMps = item.activeProductsMap[prod.id];
      if (!activeMps || activeMps.length <= 1) continue; // Keep US or if already empty

      // 2. Iterate through Non-US drop order (JP -> ES -> IT -> FR -> DE -> GB)
      for (const targetMp of NON_US_DROP_ORDER) {
        const mpIndex = activeMps.indexOf(targetMp);
        if (mpIndex !== -1) {
          // Remove from active
          activeMps.splice(mpIndex, 1);

          // Record in dropped map
          if (!item.droppedSlotsMap[prod.id]) {
            item.droppedSlotsMap[prod.id] = [];
          }
          if (!item.droppedSlotsMap[prod.id].includes(targetMp)) {
            item.droppedSlotsMap[prod.id].push(targetMp);
          }

          return true; // Successfully dropped 1 slot
        }
      }
    }

    return false; // No more non-US droppable slots available
  }
}
