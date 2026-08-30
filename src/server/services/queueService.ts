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
  publishedProductsCount?: number;            // Number of products already live on Amazon (for update items)
  liveStats?: any;                            // Live stats payload from Amazon
}

export interface QueueState {
  items: QueueItem[];
  freeDailySlots: number;
  usedSlotsToday: number;
  totalDailySlots: number;
  scheduledSlotsToday: number;
  scheduledLiveSlotsToday?: number;           // Live slots planned against Amazon daily limit
  scheduledDraftProductsToday?: number;        // Products planned for draft upload
  scheduledItemsCount: number;
  overflowItemsCount: number;
  uploadScheduleTime: string; // e.g. "04:00" or "off"
  maxDropPerDesign: number;
  autoBalance: boolean;
  maxDroppableCapacity: number;
  uploadMode: 'draft' | 'live' | 'hybrid';
  draftProductsPerDesign: number;
  maxCatalogSlots: number;
  updateTargetCount?: number;
  updateAutoBackfillEnabled?: boolean;
  updateMaxActiveProducts?: number;
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

          // Check if update item
          const isUpdate = (item.type === 'update' || item.type === 'UPDATE' || item.source === 'UPDATE' || (item.id && String(item.id).startsWith('update_')) || (item.taskId && String(item.taskId).endsWith('-U')));
          if (isUpdate) {
            if (item.publishedProductsCount === undefined) {
              const pCount = task.payload?.liveStats?.publishedCount ?? task.payload?.liveVariantsCount ?? task.payload?.publishedCount;
              if (pCount !== undefined) {
                item.publishedProductsCount = pCount;
                hasChanges = true;
              }
            }
            if (!item.liveStats && task.payload?.liveStats) {
              item.liveStats = task.payload.liveStats;
              hasChanges = true;
            }
            if (!item.designId && task.payload?.designId) {
              item.designId = task.payload.designId;
              hasChanges = true;
            }
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
    const mode = settings.queueUploadMode || 'draft';
    const isDraftMode = mode === 'draft';
    const isLiveMode = mode === 'live';
    const isHybridMode = mode === 'hybrid';
    const maxCatalogSlots = ProductCatalogService.getTotalBaseSlotsCount();
    const maxDrop = settings.queueMaxDropPerDesign ?? 10;
    const defaultDraftProducts = Math.max(1, maxCatalogSlots);
    const draftProductsPerDesign = Math.max(
      Math.max(1, maxCatalogSlots - maxDrop),
      Math.min(maxCatalogSlots, settings.queueDraftProductsPerDesign ?? defaultDraftProducts)
    );

    const isUpdateItem = (i: any) => (i.type === 'update' || i.type === 'UPDATE' || i.source === 'UPDATE' || (i.id && String(i.id).startsWith('update_')) || (i.taskId && String(i.taskId).endsWith('-U')));

    // Total scheduled slots & counts
    const activeItems = this.items.filter(i => i.status === 'UPLOADING' || i.status === 'WAITING');
    let scheduledSlotsToday = 0;
    let scheduledLiveSlotsToday = 0;
    let scheduledDraftProductsToday = 0;
    let scheduledItemsCount = 0;
    let overflowItemsCount = 0;

    for (const item of activeItems) {
      if (item.isPaused) continue;

      const isUpdate = isUpdateItem(item);

      if (item.status === 'UPLOADING') {
        const slots = item.allocatedSlots ?? item.totalBaseSlots ?? 0;
        scheduledSlotsToday += slots;
        scheduledItemsCount++;
        if (isUpdate || isLiveMode) {
          scheduledLiveSlotsToday += slots;
        } else {
          scheduledDraftProductsToday += slots;
        }
      } else if (item.status === 'WAITING') {
        if (isDraftMode) {
          if (!isUpdate) {
            const slots = item.allocatedSlots || draftProductsPerDesign;
            scheduledDraftProductsToday += slots;
            scheduledSlotsToday += slots;
            scheduledItemsCount++;
          }
        } else if (isLiveMode) {
          if (item.allocatedSlots !== undefined && item.allocatedSlots > 0) {
            scheduledLiveSlotsToday += item.allocatedSlots;
            scheduledSlotsToday += item.allocatedSlots;
            scheduledItemsCount++;
          } else if (isUpdate && item.totalBaseSlots === 0) {
            // 0-slot update design scheduled today
            scheduledItemsCount++;
          } else {
            overflowItemsCount++;
          }
        } else if (isHybridMode) {
          // Hybrid: Updates are Live, New items are Draft
          if (isUpdate) {
            scheduledLiveSlotsToday += item.allocatedSlots || 0;
            scheduledSlotsToday += item.allocatedSlots || 0;
            scheduledItemsCount++;
          } else {
            const draftSlots = item.allocatedSlots || draftProductsPerDesign;
            scheduledDraftProductsToday += draftSlots;
            scheduledSlotsToday += draftSlots;
            scheduledItemsCount++;
          }
        }
      }
    }

    return {
      items: this.items,
      freeDailySlots: this.dailySlotsInfo.free,
      usedSlotsToday: this.dailySlotsInfo.used,
      totalDailySlots: this.dailySlotsInfo.total,
      scheduledSlotsToday,
      scheduledLiveSlotsToday,
      scheduledDraftProductsToday,
      scheduledItemsCount,
      overflowItemsCount,
      uploadScheduleTime: settings.queueUploadScheduleTime || 'off',
      maxDropPerDesign: maxDrop,
      autoBalance: settings.queueAutoBalance ?? true,
      maxDroppableCapacity: ProductCatalogService.getMaxDroppableSlots(),
      uploadMode: mode,
      draftProductsPerDesign,
      maxCatalogSlots,
      updateTargetCount: settings.queueUpdateTargetCount ?? 10,
      updateAutoBackfillEnabled: settings.queueUpdateAutoBackfillEnabled ?? false,
      updateMaxActiveProducts: settings.queueUpdateMaxActiveProducts ?? 100
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
    source?: string;
    type?: 'new' | 'update';
    designId?: string;
    publishedProductsCount?: number;
    liveStats?: any;
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
    const isUpdate = (item as any).source === 'UPDATE' || (item as any).type === 'update' || (item.taskId && item.taskId.endsWith('-U'));

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
      if (item.source) existing.source = item.source;
      if (item.type) existing.type = item.type;
      if (item.designId) existing.designId = item.designId;
      if (item.publishedProductsCount !== undefined) existing.publishedProductsCount = item.publishedProductsCount;
      if (item.liveStats !== undefined) existing.liveStats = item.liveStats;

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

    const alreadyPublished = item.publishedProductsCount ?? item.liveStats?.publishedCount ?? 0;
    const netSlots = isUpdate ? Math.max(0, totalBaseSlots - alreadyPublished) : totalBaseSlots;

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
      allocatedSlots: netSlots,
      totalBaseSlots: netSlots,
      activeProductsMap,
      droppedSlotsMap: {},
      tmBlockedProductIds: item.tmBlockedProductIds || [],
      sortOrder: this.items.length,
      source: item.source || (isUpdate ? 'UPDATE' : 'NEW'),
      type: item.type || (isUpdate ? 'update' : 'new'),
      designId: item.designId,
      publishedProductsCount: item.publishedProductsCount,
      liveStats: item.liveStats
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
    publishedProductsCount?: number;
    liveStats?: any;
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
   * Toggle Pause state on a queue item
   */
  public static togglePause(queueId: string): QueueItem | null {
    this.ensureLoaded();
    const item = this.items.find(i => i.id === queueId);
    if (!item) return null;

    item.isPaused = !item.isPaused;
    this.saveQueue();
    this.rebalanceQueue();
    return item;
  }

  /**
   * Delete an item from the queue by ID or TaskID
   */
  public static deleteItem(queueId: string): boolean {
    this.ensureLoaded();
    const cleanId = (queueId || '').trim();
    const noHash = cleanId.replace(/^#/, '');
    const index = this.items.findIndex(i => 
      i.id === cleanId || 
      i.taskId === cleanId || 
      i.taskId === noHash || 
      (i.taskId && `#${i.taskId.replace(/^#/, '')}` === cleanId)
    );
    if (index === -1) return false;

    this.items.splice(index, 1);
    // Re-index sortOrder
    this.items.forEach((item, idx) => {
      item.sortOrder = idx;
    });

    this.saveQueue();
    this.rebalanceQueue();
    return true;
  }

  /**
   * Alias for deleteItem
   */
  public static removeItem(queueId: string): boolean {
    return this.deleteItem(queueId);
  }

  /**
   * Move an item to a specific position (drag & drop reordering)
   */
  public static reorderItems(queueId: string, newIndex: number): QueueState {
    this.ensureLoaded();
    const currentIndex = this.items.findIndex(i => i.id === queueId);
    if (currentIndex === -1 || newIndex < 0 || newIndex >= this.items.length) {
      return this.getState();
    }

    const [movedItem] = this.items.splice(currentIndex, 1);
    this.items.splice(newIndex, 0, movedItem);

    // Update sortOrder
    this.items.forEach((item, idx) => {
      item.sortOrder = idx;
    });

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
   * Core Smart Balancing Algorithm
   * Dynamically adjusts active product count & marketplace slots against daily limit.
   */
  public static rebalanceQueue(freeSlotsOverride?: number): QueueState {
    this.ensureLoaded();
    const settings = loadSettings();
    const mode = settings.queueUploadMode || 'draft';
    const isDraftMode = mode === 'draft';
    const isLiveMode = mode === 'live';
    const isHybridMode = mode === 'hybrid';
    const freeDailySlots = freeSlotsOverride !== undefined ? freeSlotsOverride : this.dailySlotsInfo.free;
    const maxDrop = settings.queueMaxDropPerDesign ?? 10;
    const droppableProducts = ProductCatalogService.getDroppableProductsOrdered();
    const maxCatalogSlots = ProductCatalogService.getTotalBaseSlotsCount();
    const catalog = ProductCatalogService.getCatalog();

    if (this.items.length === 0) {
      return this.getState();
    }

    const isUpdateItem = (i: any) => (i.type === 'update' || i.type === 'UPDATE' || i.source === 'UPDATE' || (i.id && String(i.id).startsWith('update_')) || (i.taskId && String(i.taskId).endsWith('-U')));

    // 1. Lock slots for currently UPLOADING items
    const uploadingItems = this.items.filter(i => i.status === 'UPLOADING');
    let uploadingSlotsReserved = 0;
    for (const upItem of uploadingItems) {
      let total = 0;
      for (const prodId in upItem.activeProductsMap) {
        total += (upItem.activeProductsMap[prodId] || []).length;
      }
      if (isUpdateItem(upItem)) {
        const alreadyPublished = upItem.publishedProductsCount ?? upItem.liveStats?.publishedCount ?? 0;
        const netSlots = Math.max(0, total - alreadyPublished);
        upItem.allocatedSlots = netSlots;
        uploadingSlotsReserved += netSlots;
      } else {
        upItem.allocatedSlots = total;
        uploadingSlotsReserved += total;
      }
    }

    const availableSlotsForWaiting = Math.max(0, freeDailySlots - uploadingSlotsReserved);
    
    // 2. Set 0 slots for paused waiting items so they do not participate in balancing
    const pausedWaitingItems = this.items.filter(i => i.status === 'WAITING' && i.isPaused);
    for (const pItem of pausedWaitingItems) {
      pItem.allocatedSlots = 0;
      pItem.droppedSlotsMap = {};
    }

    // 3. Separate non-paused waiting items into new designs and update designs
    const nonPausedWaiting = this.items.filter(i => i.status === 'WAITING' && !i.isPaused);
    const waitingNewItems = nonPausedWaiting.filter(i => !isUpdateItem(i));
    const waitingUpdateItems = nonPausedWaiting.filter(i => isUpdateItem(i));

    // 4. Reset & populate each waiting NEW item from latest catalog
    for (const item of waitingNewItems) {
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

    // 5. Reset & populate each waiting UPDATE item from latest catalog & compute net slots
    for (const uItem of waitingUpdateItems) {
      const tmBlocked = new Set((uItem.tmBlockedProductIds || []).map(id => id.toUpperCase()));
      const activeMap: Record<string, string[]> = {};
      let baseCatalogSlots = 0;

      for (const prod of catalog.products) {
        if (tmBlocked.has(prod.id.toUpperCase())) continue;
        const mps = Array.isArray(prod.availableMarketplaces) ? [...prod.availableMarketplaces] : ['US'];
        activeMap[prod.id] = mps;
        baseCatalogSlots += mps.length;
      }

      uItem.activeProductsMap = activeMap;
      uItem.droppedSlotsMap = {};

      let alreadyPublished = uItem.publishedProductsCount ?? uItem.liveStats?.publishedCount;
      if (alreadyPublished === undefined) {
        const cleanId = uItem.taskId ? uItem.taskId.replace(/^#/, '') : '';
        const t = TaskLogService.getTask(uItem.taskId) || TaskLogService.getTask(cleanId) || TaskLogService.getTask(`#${cleanId}`);
        const pCount = t?.payload?.liveStats?.publishedCount ?? t?.payload?.liveVariantsCount ?? t?.payload?.publishedCount;
        if (pCount !== undefined) {
          alreadyPublished = pCount;
          uItem.publishedProductsCount = pCount;
          if (t?.payload?.liveStats) uItem.liveStats = t.payload.liveStats;
          if (t?.payload?.designId && !uItem.designId) uItem.designId = t.payload.designId;
        } else {
          // If already live on Amazon and backfilled before 109 products, default to previous full catalog (106)
          alreadyPublished = 106;
          uItem.publishedProductsCount = 106;
        }
      }

      const netSlots = Math.max(0, baseCatalogSlots - (alreadyPublished ?? 0));
      uItem.totalBaseSlots = netSlots;
      uItem.allocatedSlots = netSlots;
    }

    // 6. Branching based on Mode (Draft, Live, Draft-Hybrid)
    if (isDraftMode) {
      // DRAFT MODE: All waiting new designs uploaded as DRAFT (0 Amazon slots consumed).
      // Update designs are NOT uploaded in pure Draft mode (allocatedSlots = 0).
      for (const uItem of waitingUpdateItems) {
        uItem.allocatedSlots = 0;
      }

      const targetDraftProducts = Math.max(
        Math.max(1, maxCatalogSlots - maxDrop),
        Math.min(maxCatalogSlots, settings.queueDraftProductsPerDesign ?? maxCatalogSlots)
      );

      for (const item of waitingNewItems) {
        if (item.isLocked) {
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
    } else if (isLiveMode) {
      // LIVE MODE: 
      // Prio 1: New Designs Live (consume daily slots)
      // Prio 2: Fill remaining slots with Update Designs (consuming their netSlots)

      let accumulatedMinSlots = 0;
      const scheduledNewItems: QueueItem[] = [];
      const overflowNewItems: QueueItem[] = [];

      for (const item of waitingNewItems) {
        const minRequired = item.isLocked ? item.totalBaseSlots : Math.max(1, item.totalBaseSlots - maxDrop);
        if (accumulatedMinSlots + minRequired <= availableSlotsForWaiting || scheduledNewItems.length === 0) {
          accumulatedMinSlots += minRequired;
          scheduledNewItems.push(item);
        } else {
          overflowNewItems.push(item);
        }
      }

      // Dynamic Slot Balancing across scheduled waiting new designs
      const totalRequestedSlots = scheduledNewItems.reduce((sum, item) => sum + item.totalBaseSlots, 0);

      if (totalRequestedSlots > availableSlotsForWaiting && scheduledNewItems.length > 0) {
        let slotsToDropTotal = totalRequestedSlots - availableSlotsForWaiting;
        const unlockedScheduled = scheduledNewItems.filter(i => !i.isLocked);

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

      let usedSlotsByNew = 0;
      for (const item of scheduledNewItems) {
        let total = 0;
        for (const prodId in item.activeProductsMap) {
          total += (item.activeProductsMap[prodId] || []).length;
        }
        item.allocatedSlots = total;
        usedSlotsByNew += total;
      }

      for (const item of overflowNewItems) {
        item.allocatedSlots = 0;
      }

      // Prio 2: Allocate remaining slots to Update Items
      let remainingSlotsForUpdates = Math.max(0, availableSlotsForWaiting - usedSlotsByNew);
      for (const uItem of waitingUpdateItems) {
        if (uItem.totalBaseSlots <= remainingSlotsForUpdates || uItem.totalBaseSlots === 0) {
          uItem.allocatedSlots = uItem.totalBaseSlots;
          remainingSlotsForUpdates -= uItem.totalBaseSlots;
        } else {
          uItem.allocatedSlots = 0;
        }
      }
    } else if (isHybridMode) {
      // DRAFT-HYBRID MODE:
      // Prio 1 (Live): Update Designs uploaded LIVE (utilizing daily slots)
      // Prio 2 (Draft): New Designs uploaded as DRAFT (0 Amazon slots consumed)

      let remainingLiveSlots = availableSlotsForWaiting;
      for (const uItem of waitingUpdateItems) {
        if (uItem.totalBaseSlots <= remainingLiveSlots || uItem.totalBaseSlots === 0) {
          uItem.allocatedSlots = uItem.totalBaseSlots;
          remainingLiveSlots -= uItem.totalBaseSlots;
        } else {
          uItem.allocatedSlots = 0;
        }
      }

      // New designs in Hybrid mode are trimmed to target draft products
      const targetDraftProducts = Math.max(
        Math.max(1, maxCatalogSlots - maxDrop),
        Math.min(maxCatalogSlots, settings.queueDraftProductsPerDesign ?? maxCatalogSlots)
      );

      for (const item of waitingNewItems) {
        if (item.isLocked) {
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
