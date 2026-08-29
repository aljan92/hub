import fs from 'fs';
import path from 'path';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
import { loadSettings, saveSettings } from './settingsService';

export type QueueItemStatus = 'WAITING' | 'UPLOADING' | 'COMPLETED' | 'ERROR';

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
  isPaused?: boolean; // Paused by user: excluded from balancing and auto-upload
  allocatedSlots: number;
  totalBaseSlots: number;
  activeProductsMap: Record<string, string[]>; // productId -> array of active marketplaces (e.g. ['US', 'DE', 'GB'])
  droppedSlotsMap: Record<string, string[]>;   // productId -> array of dropped marketplaces (e.g. ['JP', 'ES', 'IT'])
  tmBlockedProductIds: string[];              // Product IDs blocked by TM
  errorMessage?: string;
  sortOrder: number;
  uploadedAt?: string;
  lastUploadAttempt?: string;
  source?: string;
  type?: 'new' | 'update';
  designId?: string;
}

export interface QueueState {
  items: QueueItem[];
  freeDailySlots: number;
  usedSlotsToday: number;
  totalDailySlots: number;
  scheduledSlotsToday: number;
  scheduledItemsCount: number;
  overflowItemsCount: number;
  uploadScheduleTime: string; // e.g. "04:00" or "off"
  maxDropPerDesign: number;
  autoBalance: boolean;
  maxDroppableCapacity: number;
  uploadMode: 'draft' | 'live';
  draftProductsPerDesign: number;
  maxCatalogSlots: number;
  updateTargetCount?: number;
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

          // Migrate legacy status to clean 4-state model
          for (const item of this.items) {
            if ((item.status as any) === 'SCHEDULED_TODAY' || (item.status as any) === 'WAITING_FOR_SLOTS' || !item.status) {
              item.status = 'WAITING';
            }
          }

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

  public static getActiveQueueCount(): number {
    this.ensureLoaded();
    return this.items.filter(i => i.status === 'WAITING' || i.status === 'UPLOADING').length;
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
    } catch (err: any) {
      console.error('[QueueService] enrichListings error:', err.message);
    }
  }

  /**
   * Save queue to ./data/upload_queue.json
   */
  public static saveQueue() {
    try {
      const dir = path.dirname(this.queueFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.queueFilePath, JSON.stringify(this.items, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[QueueService] Error writing upload_queue.json:', err.message);
    }
  }

  /**
   * Set daily available slots from live MBA Dashboard / Ratelimiter
   */
  public static setDailySlots(free: number, used = 0, total = 200) {
    this.dailySlotsInfo = { free: Math.max(0, free), used, total };
    this.rebalanceQueue();
  }

  /**
   * Get complete queue state
   */
  public static getState(): QueueState {
    this.ensureLoaded();
    const settings = loadSettings();
    const isDraftMode = (settings.queueUploadMode || 'draft') === 'draft';
    const maxCatalogSlots = ProductCatalogService.getTotalBaseSlotsCount();
    const maxDrop = settings.queueMaxDropPerDesign ?? 10;
    const defaultDraftProducts = Math.max(1, maxCatalogSlots);
    const draftProductsPerDesign = Math.max(
      Math.max(1, maxCatalogSlots - maxDrop),
      Math.min(maxCatalogSlots, settings.queueDraftProductsPerDesign ?? defaultDraftProducts)
    );

    // Total scheduled slots & counts
    const activeItems = this.items.filter(i => i.status === 'UPLOADING' || i.status === 'WAITING');
    let scheduledSlotsToday = 0;
    let scheduledItemsCount = 0;
    let overflowItemsCount = 0;

    for (const item of activeItems) {
      if (item.status === 'UPLOADING') {
        scheduledSlotsToday += item.allocatedSlots || item.totalBaseSlots || 0;
        scheduledItemsCount++;
      } else if (item.status === 'WAITING') {
        if (item.isPaused) {
          // Paused items are completely excluded from balancing and scheduled counts
          continue;
        }
        if (isDraftMode || (item.allocatedSlots && item.allocatedSlots > 0)) {
          scheduledSlotsToday += item.allocatedSlots || 0;
          scheduledItemsCount++;
        } else {
          overflowItemsCount++;
        }
      }
    }

    return {
      items: this.items,
      freeDailySlots: this.dailySlotsInfo.free,
      usedSlotsToday: this.dailySlotsInfo.used,
      totalDailySlots: this.dailySlotsInfo.total,
      scheduledSlotsToday,
      scheduledItemsCount,
      overflowItemsCount,
      uploadScheduleTime: settings.queueUploadScheduleTime || 'off',
      maxDropPerDesign: maxDrop,
      autoBalance: settings.queueAutoBalance ?? true,
      maxDroppableCapacity: ProductCatalogService.getMaxDroppableSlots(),
      uploadMode: settings.queueUploadMode || 'draft',
      draftProductsPerDesign,
      maxCatalogSlots,
      updateTargetCount: settings.queueUpdateTargetCount ?? 10
    };
  }

  /**
   * Enqueue a newly approved design
   */
  public static enqueueDesign(item: {
    taskId: string;
    designTitle: string;
    niche?: string;
    brand?: string;
    title?: string;
    bullet1?: string;
    bullet2?: string;
    description?: string;
    listings?: Record<string, ListingLanguageContent>;
    fitTypes?: string[];
    avoidColor?: 'white' | 'black' | 'none';
    customBackgroundColor?: string;
    imagePath: string;
    pngPath: string;
    tmBlockedProductIds?: string[];
  }): QueueItem {
    this.ensureLoaded();

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

    // Check if task is already in queue
    const existing = this.items.find(i => i.taskId === item.taskId);
    const isUpdate = (item as any).source === 'UPDATE' || (item as any).type === 'update';

    if (existing) {
      existing.status = 'WAITING';
      existing.errorMessage = undefined;
      if (item.title) existing.title = cleanStr(item.title);
      if (item.brand) existing.brand = cleanStr(item.brand);
      if (item.bullet1) existing.bullet1 = cleanStr(item.bullet1);
      if (item.bullet2) existing.bullet2 = cleanStr(item.bullet2);
      if (item.description) existing.description = cleanStr(item.description);
      if (item.listings) existing.listings = item.listings;
      if (item.fitTypes) existing.fitTypes = item.fitTypes;
      if (item.avoidColor) existing.avoidColor = item.avoidColor;
      if (item.customBackgroundColor) existing.customBackgroundColor = item.customBackgroundColor;
      if (item.pngPath) existing.pngPath = item.pngPath;
      if (item.imagePath) existing.imagePath = item.imagePath;
      if ((item as any).source) existing.source = (item as any).source;
      if ((item as any).type) existing.type = (item as any).type;
      if ((item as any).designId) existing.designId = (item as any).designId;
      if (isUpdate) {
        existing.allocatedSlots = 0;
        existing.totalBaseSlots = 0;
      }
      this.saveQueue();
      this.rebalanceQueue();
      return existing;
    }

    const catalog = ProductCatalogService.getCatalog();
    const tmBlocked = new Set((item.tmBlockedProductIds || []).map(id => id.toUpperCase()));
    
    // Build initial activeProductsMap with all non-blocked products
    const activeProductsMap: Record<string, string[]> = {};
    let totalBaseSlots = 0;

    for (const prod of catalog.products) {
      if (tmBlocked.has(prod.id.toUpperCase())) continue;
      const mps = Array.isArray(prod.availableMarketplaces) ? [...prod.availableMarketplaces] : ['US'];
      activeProductsMap[prod.id] = mps;
      totalBaseSlots += mps.length;
    }

    const newItem: QueueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      taskId: item.taskId,
      designTitle: cleanStr(item.designTitle),
      niche: cleanStr(item.niche || ''),
      brand: cleanStr(item.brand || 'MBA Hub Studio'),
      title: cleanStr(item.title || item.designTitle),
      bullet1: cleanStr(item.bullet1 || ''),
      bullet2: cleanStr(item.bullet2 || ''),
      description: cleanStr(item.description || ''),
      listings: item.listings || {
        en: {
          brand: cleanStr(item.brand || 'MBA Hub Studio'),
          title: cleanStr(item.title || item.designTitle),
          bullet1: cleanStr(item.bullet1 || ''),
          bullet2: cleanStr(item.bullet2 || ''),
          description: cleanStr(item.description || '')
        }
      },
      fitTypes: item.fitTypes || ['men', 'women', 'youth'],
      avoidColor: item.avoidColor || 'none',
      customBackgroundColor: item.customBackgroundColor,
      imagePath: item.imagePath,
      pngPath: item.pngPath,
      addedAt: new Date().toISOString(),
      status: 'WAITING',
      isLocked: false,
      allocatedSlots: isUpdate ? 0 : totalBaseSlots,
      totalBaseSlots: isUpdate ? 0 : totalBaseSlots,
      activeProductsMap,
      droppedSlotsMap: {},
      tmBlockedProductIds: item.tmBlockedProductIds || [],
      sortOrder: this.items.length,
      source: (item as any).source || (isUpdate ? 'UPDATE' : 'NEW'),
      type: (item as any).type || (isUpdate ? 'update' : 'new'),
      designId: (item as any).designId
    };

    this.items.push(newItem);
    this.saveQueue();
    this.rebalanceQueue();

    return newItem;
  }

  public static enqueueItem(item: {
    taskId: string;
    designTitle?: string;
    niche?: string;
    brand?: string;
    title?: string;
    bullet1?: string;
    bullet2?: string;
    description?: string;
    listings?: Record<string, ListingLanguageContent>;
    fitTypes?: string[];
    avoidColor?: 'white' | 'black' | 'none';
    customBackgroundColor?: string;
    imagePath: string;
    pngPath: string;
    tmBlockedProductIds?: string[];
    source?: string;
    type?: 'new' | 'update';
    designId?: string;
  }): QueueItem {
    return this.enqueueDesign({
      ...item,
      designTitle: item.designTitle || item.title || 'Design #' + item.taskId
    });
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
   * Retry/Re-enqueue an item from ERROR or COMPLETED back to WAITING
   */
  public static retryItem(queueId: string): QueueItem | null {
    this.ensureLoaded();
    const item = this.items.find(i => i.id === queueId);
    if (!item) return null;

    item.status = 'WAITING';
    item.errorMessage = undefined;
    item.sortOrder = this.items.filter(i => i.status === 'WAITING' || i.status === 'UPLOADING').length;
    this.saveQueue();
    this.rebalanceQueue();
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
   * Toggle Pause on a queue item (excludes from balancing & upload).
   * When re-activating, moves the item to the very bottom of the queue.
   */
  public static togglePause(queueId: string): QueueItem | null {
    this.ensureLoaded();
    const item = this.items.find(i => i.id === queueId);
    if (!item) return null;

    const wasPaused = !!item.isPaused;
    item.isPaused = !wasPaused;

    if (wasPaused) {
      // Re-activating: move item to the very bottom of the queue
      this.items = this.items.filter(i => i.id !== queueId);
      this.items.push(item);
      this.items.forEach((it, idx) => {
        it.sortOrder = idx;
      });
    }

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
    const isDraftMode = (settings.queueUploadMode || 'draft') === 'draft';
    const freeDailySlots = freeSlotsOverride !== undefined ? freeSlotsOverride : this.dailySlotsInfo.free;
    const maxDrop = settings.queueMaxDropPerDesign ?? 10;
    const droppableProducts = ProductCatalogService.getDroppableProductsOrdered();
    const maxCatalogSlots = ProductCatalogService.getTotalBaseSlotsCount();

    if (this.items.length === 0) {
      return this.getState();
    }

    // 1. Lock slots for currently UPLOADING items
    const uploadingItems = this.items.filter(i => i.status === 'UPLOADING');
    let uploadingSlotsReserved = 0;
    for (const upItem of uploadingItems) {
      let total = 0;
      for (const prodId in upItem.activeProductsMap) {
        total += (upItem.activeProductsMap[prodId] || []).length;
      }
      upItem.allocatedSlots = total;
      uploadingSlotsReserved += total;
    }

    const availableSlotsForWaiting = Math.max(0, freeDailySlots - uploadingSlotsReserved);
    
    // Set 0 slots for paused waiting items so they do not participate in balancing
    const pausedWaitingItems = this.items.filter(i => i.status === 'WAITING' && i.isPaused);
    for (const pItem of pausedWaitingItems) {
      pItem.allocatedSlots = 0;
      pItem.droppedSlotsMap = {};
    }

    // Set 0 slots for update items (they update published products with 0 slot consumption)
    const updateWaitingItems = this.items.filter(i => i.status === 'WAITING' && ((i as any).type === 'update' || (i as any).source === 'UPDATE'));
    for (const uItem of updateWaitingItems) {
      uItem.allocatedSlots = 0;
      uItem.totalBaseSlots = 0;
      uItem.droppedSlotsMap = {};
    }

    const waitingItems = this.items.filter(i => i.status === 'WAITING' && !i.isPaused && (i as any).type !== 'update' && (i as any).source !== 'UPDATE');

    // 2. Reset each waiting item to its full TM-compliant base allocation
    const catalog = ProductCatalogService.getCatalog();
    for (const item of waitingItems) {
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

    // 3. Branching: Draft Mode vs. Live Mode
    if (isDraftMode) {
      // DRAFT MODE: Draft uploads do NOT consume daily Amazon publishing slots.
      // Every waiting item is trimmed to have exactly `draftProductsPerDesign` products.
      const targetDraftProducts = Math.max(
        Math.max(1, maxCatalogSlots - maxDrop),
        Math.min(maxCatalogSlots, settings.queueDraftProductsPerDesign ?? maxCatalogSlots)
      );

      for (const item of waitingItems) {
        if (item.isLocked) {
          // Locked hero designs keep 100% of base slots
          item.allocatedSlots = item.totalBaseSlots;
          continue;
        }

        const dropsNeeded = Math.max(0, item.totalBaseSlots - targetDraftProducts);
        for (let d = 0; d < dropsNeeded; d++) {
          const dropped = this.dropOneSlotFromItem(item, droppableProducts);
          if (!dropped) break;
        }

        let total = 0;
        for (const prodId in item.activeProductsMap) {
          total += (item.activeProductsMap[prodId] || []).length;
        }
        item.allocatedSlots = total;
      }
    } else {
      // LIVE MODE: Publish uploads consume daily free slots quota.
      // Capacity & Smart Selection: Determine how many waiting designs can fit today
      let accumulatedMinSlots = 0;
      const scheduledWaitingItems: QueueItem[] = [];
      const overflowWaitingItems: QueueItem[] = [];

      for (const item of waitingItems) {
        const minRequired = item.isLocked ? item.totalBaseSlots : Math.max(1, item.totalBaseSlots - maxDrop);
        if (accumulatedMinSlots + minRequired <= availableSlotsForWaiting || scheduledWaitingItems.length === 0) {
          accumulatedMinSlots += minRequired;
          scheduledWaitingItems.push(item);
        } else {
          overflowWaitingItems.push(item);
        }
      }

      // Dynamic Slot Balancing across scheduled waiting designs
      const totalRequestedSlots = scheduledWaitingItems.reduce((sum, item) => sum + item.totalBaseSlots, 0);

      if (totalRequestedSlots > availableSlotsForWaiting && scheduledWaitingItems.length > 0) {
        let slotsToDropTotal = totalRequestedSlots - availableSlotsForWaiting;
        const unlockedScheduled = scheduledWaitingItems.filter(i => !i.isLocked);

        const dropsPerItem: Record<string, number> = {};
        unlockedScheduled.forEach(i => { dropsPerItem[i.id] = 0; });

        let progressMade = true;
        while (slotsToDropTotal > 0 && progressMade && unlockedScheduled.length > 0) {
          progressMade = false;
          for (const item of unlockedScheduled) {
            if (slotsToDropTotal <= 0) break;
            const currentDrops = dropsPerItem[item.id];
            if (currentDrops < maxDrop) {
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

      // Update allocatedSlots for all items
      for (const item of scheduledWaitingItems) {
        let total = 0;
        for (const prodId in item.activeProductsMap) {
          total += (item.activeProductsMap[prodId] || []).length;
        }
        item.allocatedSlots = total;
      }

      for (const item of overflowWaitingItems) {
        item.allocatedSlots = 0;
      }
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
