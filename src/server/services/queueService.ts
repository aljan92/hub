import fs from 'fs';
import path from 'path';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
import { loadSettings, saveSettings } from './settingsService';

export type QueueItemStatus = 'SCHEDULED_TODAY' | 'WAITING_FOR_SLOTS' | 'UPLOADING' | 'COMPLETED' | 'ERROR';

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
  private static items: QueueItem[] = [];
  private static isLoaded = false;
  private static dailySlotsInfo = { free: 200, used: 0, total: 200 };

  private static ensureLoaded() {
    if (this.isLoaded) return;
    this.loadQueue();
    this.isLoaded = true;
  }

  /**
   * Load queue from ./data/upload_queue.json
   */
  public static loadQueue(): QueueItem[] {
    try {
      if (fs.existsSync(this.queueFilePath)) {
        const raw = fs.readFileSync(this.queueFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed;
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
    imagePath: string;
    pngPath: string;
    tmBlockedProductIds?: string[];
  }): QueueItem {
    this.ensureLoaded();

    // Check if already in queue
    const existing = this.items.find(i => i.taskId === item.taskId);
    if (existing) {
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
