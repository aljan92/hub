import fs from 'fs';
import path from 'path';
import { ProductCatalogService, MerchProduct } from './productCatalogService';
import { ListingSanitizationService } from './listingSanitizationService';
import { loadSettings, saveSettings } from './settingsService';
import { TaskRepository } from '../storage/taskRepository';
import { atomicWriteJson, loadJsonWithBackupRecovery, isFileInFailSafe } from '../utils/atomicFileStorage';

import { 
  RemoteVerificationResult, 
  RemoteResponseInfo, 
  RemoteBaselineInfo, 
  RemoteVerificationInfo, 
  UploadRecoveryHistoryEntry 
} from '../../types/tasks';

export type QueueItemStatus = 'WAITING' | 'UPLOADING' | 'COMPLETED' | 'ERROR';

export type UploadRecoveryPhase =
  | 'STARTING'
  | 'NAVIGATING'
  | 'CONFIGURING'
  | 'VALIDATING'
  | 'READY_TO_SUBMIT'
  | 'REMOTE_ACTION_INTENT' // legacy P3.1
  | 'REMOTE_REQUEST_INTENT' // P3.3 unified pre-remote-request boundary
  | 'AWAITING_AMAZON_CONFIRMATION'
  | 'AMAZON_CONFIRMED';

export interface UploadRecoveryMetadata {
  phase: UploadRecoveryPhase;
  action?: 'PUBLISH' | 'SAVE_DRAFT';
  attempt: number;
  startedAt?: string;
  lastHeartbeatAt?: string;
  remoteActionIntentAt?: string; // legacy support
  remoteRequestIntentAt?: string; // P3.3
  amazonConfirmedAt?: string;
  amazonDesignId?: string;
  recoveryReason?: string;
  remoteResponse?: RemoteResponseInfo;
  remoteBaseline?: RemoteBaselineInfo;
  intendedRemoteFingerprint?: string;
  remoteVerification?: RemoteVerificationInfo;
  manualOverride?: {
    action: 'FORCE_RETRY' | 'MARK_CONFIRMED' | 'CANCEL';
    timestamp: string;
    reason?: string;
  };
  history?: UploadRecoveryHistoryEntry[];
}

export interface ListingLanguageContent {
  brand?: string;
  title?: string;
  bullet1?: string;
  bullet2?: string;
  description?: string;
}

export type ProductUploadStatus = 
  | 'SUCCESS'
  | 'SKIPPED_NOT_SELECTED'
  | 'SKIPPED_UNAVAILABLE'
  | 'SKIPPED_TM_BLOCKED'
  | 'FAILED_CHECKBOX_NOT_FOUND'
  | 'FAILED_CARD_NOT_FOUND'
  | 'FAILED_EDITOR_OPEN'
  | 'FAILED_FIT_TYPE'
  | 'FAILED_COLOR_CONFIGURATION'
  | 'FAILED_ARTWORK_RESOLUTION'
  | 'FAILED_ARTWORK_UPLOAD'
  | 'FAILED_LISTING_INTEGRITY'
  | 'FAILED_UNKNOWN';

export interface ProductUploadResult {
  productId: string;
  amazonKey: string;
  status: ProductUploadStatus;
  reason?: string;
}

export interface UploadResultSummary {
  totalRequested: number;
  successful: number;
  skipped: number;
  failed: number;
  results: ProductUploadResult[];
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
  resizedAssets?: {
    trimmedPath?: string;
    mugStandardPath?: string;
    mugBrushPath?: string;
    drinkwareStandardPath?: string;
    drinkwareBrushPath?: string;
    productVariants?: Record<string, string>;
  };
  addedAt: string;
  status: QueueItemStatus;
  isLocked: boolean; // Hero-Design Lock: protects from dynamic slot dropping
  isPaused?: boolean; // Paused by user: excluded from balancing and auto-upload
  allocatedSlots: number;
  totalBaseSlots: number;
  activeProductsMap: Record<string, string[]>; // productId -> array of active marketplaces (e.g. ['US', 'DE', 'GB'])
  droppedSlotsMap: Record<string, string[]>;   // productId -> array of dropped marketplaces (e.g. ['JP', 'ES', 'IT'])
  tmBlockedProductIds: string[];              // Product IDs blocked by TM
  uploadResultSummary?: UploadResultSummary;  // Per-product upload summary from UploadWorker V2
  errorMessage?: string;
  sortOrder: number;
  uploadedAt?: string;
  lastUploadAttempt?: string;
  source?: string;
  type?: 'new' | 'update';
  designId?: string;
  publishedProductsCount?: number;            // Number of products already live on Amazon (for update items)
  liveStats?: any;                            // Live stats payload from Amazon
  liveProductSummary?: Record<string, any>;   // Specific product summary already live on Amazon
  liveProductTypes?: string[];                // Product type keys already live on Amazon
  uploadRecovery?: UploadRecoveryMetadata;    // Persistent recovery and phase metadata
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
  updateCurrentCount?: number;
  catalogProducts?: any[];
}

// Strict drop sequence for non-US marketplaces within a droppable product
const NON_US_DROP_ORDER = ['JP', 'ES', 'IT', 'FR', 'DE', 'GB'];

// Helper to normalize marketplace codes across Amazon variants
export function normalizeMarketplaceCode(raw: string): string {
  const s = String(raw).trim().toUpperCase();
  if (['US', '1', 'COM', 'AMAZON.COM', 'ATVPDKIKX0DER'].includes(s)) return 'US';
  if (['GB', 'UK', '3', 'CO.UK', 'AMAZON.CO.UK', 'A1F83G8C2ARO7P'].includes(s)) return 'GB';
  if (['DE', '4', 'AMAZON.DE', 'A1PA6795UKMFR9'].includes(s)) return 'DE';
  if (['FR', '5', 'AMAZON.FR', 'A13V1IB3VIYZZH'].includes(s)) return 'FR';
  if (['IT', '6', 'AMAZON.IT', 'APJ6JRA9NG5V4'].includes(s)) return 'IT';
  if (['ES', '7', 'AMAZON.ES', 'A1RKKUPIHCS9HS'].includes(s)) return 'ES';
  if (['JP', '8', 'CO.JP', 'AMAZON.CO.JP', 'A1VC38T7YXB528'].includes(s)) return 'JP';
  return s;
}

// Helper to normalize Amazon product keys to exact catalog product IDs via dynamic ProductCatalogService
export function normalizeCatalogProductId(raw: string): string {
  const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_');
  const matched = ProductCatalogService.findProductByAmazonKey(s);
  return matched ? matched.id : s;
}

export class QueueService {
  private static queueFilePath = path.resolve(process.cwd(), 'data', 'upload_queue.json');
  private static items: QueueItem[] = [];
  private static isLoaded = false;
  private static isStorageCorrupted = false;
  private static dailySlotsInfo = { free: 200, used: 0, total: 200 };

  public static setCustomQueuePath(customPath?: string): void {
    if (customPath) {
      this.queueFilePath = path.resolve(customPath);
    } else {
      this.queueFilePath = path.resolve(process.cwd(), 'data', 'upload_queue.json');
    }
    this.isLoaded = false;
    this.isStorageCorrupted = false;
  }

  public static isCorrupted(): boolean {
    return this.isStorageCorrupted || isFileInFailSafe(this.queueFilePath);
  }

  public static ensureLoaded() {
    if (this.isLoaded) return;
    this.loadQueue();
    this.isLoaded = true;
  }

  /**
   * Load queue from ./data/upload_queue.json with atomic backup recovery & corruption shield
   */
  public static loadQueue(): QueueItem[] {
    try {
      if (fs.existsSync(this.queueFilePath)) {
        const recovery = loadJsonWithBackupRecovery<QueueItem[]>(this.queueFilePath, {
          backupExt: '.bak',
          validate: (data) => Array.isArray(data),
          defaultValue: []
        });

        if (!recovery.success) {
          this.isStorageCorrupted = true;
          console.error(`[QueueService] 🚨 CRITICAL: upload_queue.json and backup could not be loaded/validated from '${this.queueFilePath}'! Fail-closed mode active.`);
          return this.items;
        }

        this.isStorageCorrupted = false;
        this.items = recovery.data;

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
    } catch (err: any) {
      console.error('[QueueService] Error reading upload_queue.json:', err.message);
      this.isStorageCorrupted = true;
      return this.items;
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
      let hasChanges = false;

      for (const item of this.items) {
        if (!item.taskId) continue;
        const task = TaskRepository.getTaskById(item.taskId);
        if (task) {
          const listing = task.listingResult || task.trademarkRefineResult || {};
          const enListing = listing.en || (listing.title || listing.brand ? listing : {});
          
          if (!item.brand || item.brand === '—') item.brand = enListing.brand || task.payload?.brand || '';
          if (!item.title || item.title === 'Neues Design') item.title = enListing.title || task.payload?.title || task.payload?.quote || '';
          if (!item.bullet1) item.bullet1 = enListing.bullet1 || enListing.bullet_1 || '';
          if (!item.bullet2) item.bullet2 = enListing.bullet2 || enListing.bullet_2 || '';
          if (!item.description) item.description = enListing.description || '';
          if (!item.niche && task.payload?.niche) item.niche = task.payload.niche;

          // Build multi-language listings map
          if (!item.listings || Object.keys(item.listings).length === 0) {
            const listings: Record<string, ListingLanguageContent> = {};
            if (typeof listing === 'object') {
              for (const [key, val] of Object.entries(listing)) {
                if (val && typeof val === 'object' && !Array.isArray(val) && !key.startsWith('_')) {
                  const langContent = val as any;
                  listings[key.toLowerCase()] = {
                    brand: langContent.brand || item.brand,
                    title: langContent.title || item.title,
                    bullet1: langContent.bullet1 || langContent.bullet_1 || '',
                    bullet2: langContent.bullet2 || langContent.bullet_2 || '',
                    description: langContent.description || ''
                  };
                }
              }
            }
            if (!listings.en && (item.title || item.brand)) {
              listings.en = {
                brand: item.brand,
                title: item.title,
                bullet1: item.bullet1,
                bullet2: item.bullet2,
                description: item.description
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
            if (!item.liveProductSummary && task.payload?.productSummary) {
              item.liveProductSummary = task.payload.productSummary;
              hasChanges = true;
            }
            if (!item.liveProductTypes && task.payload?.productTypes) {
              item.liveProductTypes = task.payload.productTypes;
              hasChanges = true;
            }
            if (!item.designId && task.payload?.designId) {
              item.designId = task.payload.designId;
              hasChanges = true;
            }
          }

          // Auto-enrich tmBlockedProductIds from task if missing in queue item
          if ((!item.tmBlockedProductIds || item.tmBlockedProductIds.length === 0) && (task.blockedProducts || task.trademarkCheckResult?.blockedProducts)) {
            const rawBlocked = task.blockedProducts || task.trademarkCheckResult?.blockedProducts || [];
            if (Array.isArray(rawBlocked) && rawBlocked.length > 0) {
              item.tmBlockedProductIds = rawBlocked.map(p => typeof p === 'object' && p ? String((p as any).id || (p as any).name || '') : String(p)).filter(Boolean);
              hasChanges = true;
            }
          }
        }
      }

      if (hasChanges) {
        this.saveQueue();
      }
    } catch (err: any) {
      console.error('[QueueService] enrichListings error:', err.message);
    }
  }

  /**
   * Save queue to ./data/upload_queue.json with atomic fsync, backup rotation (.bak) and corruption shielding
   */
  public static saveQueue() {
    if (this.isCorrupted()) {
      throw new Error(`[QueueService] 🚨 REFUSED: Cannot save queue while storage '${this.queueFilePath}' is in fail-safe corrupted mode.`);
    }
    try {
      atomicWriteJson(this.queueFilePath, this.items, {
        backup: true,
        backupExt: '.bak',
        space: 0
      });
    } catch (err: any) {
      console.error('[QueueService] Error writing upload_queue.json:', err.message);
      throw err;
    }
  }

  /**
   * Updates an item's upload recovery phase and atomically persists to disk.
   * Throws immediately if write fails (e.g. corruption guard or disk error).
   */
  public static updateItemUploadRecovery(itemId: string, recoveryUpdates: Partial<UploadRecoveryMetadata>): QueueItem | null {
    this.ensureLoaded();
    const item = this.items.find(i => i.id === itemId);
    if (!item) return null;

    const currentRecovery: UploadRecoveryMetadata = item.uploadRecovery || {
      phase: 'STARTING',
      attempt: 1,
      startedAt: new Date().toISOString()
    };

    item.uploadRecovery = {
      ...currentRecovery,
      ...recoveryUpdates,
      lastHeartbeatAt: new Date().toISOString()
    };

    this.saveQueue();
    return item;
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
      updateMaxActiveProducts: settings.queueUpdateMaxActiveProducts ?? 100,
      updateCurrentCount: (() => {
        try {
          const { UpdateBackfillService } = require('./updateBackfillService');
          return UpdateBackfillService.getActiveUpdateCount().currentCount;
        } catch {
          return this.items.filter(i => isUpdateItem(i) && i.status !== 'COMPLETED' && i.status !== 'ERROR').length;
        }
      })(),
      catalogProducts: ProductCatalogService.getCatalog().products
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
    resizedAssets?: {
      trimmedPath?: string;
      mugStandardPath?: string;
      mugBrushPath?: string;
      drinkwareStandardPath?: string;
      drinkwareBrushPath?: string;
      productVariants?: Record<string, string>;
    };
    tmBlockedProductIds?: string[];
    source?: string;
    type?: 'new' | 'update';
    designId?: string;
    publishedProductsCount?: number;
    liveStats?: any;
    liveProductSummary?: Record<string, any>;
    liveProductTypes?: string[];
  }): QueueItem {
    this.ensureLoaded();

    const cleanStr = (txt: string) => ListingSanitizationService.sanitizeText(txt);

    // Normalization helper for avoidColor
    const normalizeAvoidColor = (val: any): 'white' | 'black' | 'none' => {
      const raw = typeof val === 'object' && val ? String(val.avoid || val.color || 'none') : String(val || 'none');
      const lower = raw.toLowerCase();
      if (lower.includes('white') || lower.includes('weiß')) return 'white';
      if (lower.includes('black') || lower.includes('schwarz')) return 'black';
      return 'none';
    };

    // Normalization helper for fitTypes
    const normalizeFitTypes = (val: any): string[] => {
      if (Array.isArray(val)) {
        const mapped = val.map(f => typeof f === 'object' && f ? String((f as any).id || (f as any).name || (f as any).label || '') : String(f)).map(s => s.trim().toLowerCase()).filter(Boolean);
        return mapped.length > 0 ? mapped : ['men', 'women', 'youth'];
      }
      if (typeof val === 'string' && val.trim()) {
        const fits: string[] = [];
        const lower = val.toLowerCase();
        if (lower.includes('men') || lower.includes('männer') || lower.includes('herren')) fits.push('men');
        if (lower.includes('women') || lower.includes('frauen') || lower.includes('damen')) fits.push('women');
        if (lower.includes('youth') || lower.includes('kids') || lower.includes('kinder') || lower.includes('jugend')) fits.push('youth');
        return fits.length > 0 ? fits : ['men', 'women', 'youth'];
      }
      return ['men', 'women', 'youth'];
    };

    // Normalization helper for tmBlockedProductIds
    const normalizeTmBlocked = (val: any): string[] => {
      if (!Array.isArray(val)) return [];
      return val
        .map(p => typeof p === 'object' && p ? String((p as any).id || (p as any).name || (p as any).productId || '') : String(p))
        .map(s => s.trim())
        .filter(Boolean);
    };

    // Check if task is already in queue
    const existing = this.items.find(i => i.taskId === item.taskId);
    const isUpdate = (item as any).source === 'UPDATE' || (item as any).type === 'update' || (item.taskId && item.taskId.endsWith('-U'));

    if (existing) {
      existing.status = 'WAITING';
      existing.errorMessage = undefined;
      if (item.title) existing.title = item.title;
      if (item.brand) existing.brand = item.brand;
      if (item.bullet1) existing.bullet1 = item.bullet1;
      if (item.bullet2) existing.bullet2 = item.bullet2;
      if (item.description) existing.description = item.description;
      if (item.listings) existing.listings = item.listings;
      if (item.fitTypes !== undefined) existing.fitTypes = normalizeFitTypes(item.fitTypes);
      if (item.avoidColor !== undefined) existing.avoidColor = normalizeAvoidColor(item.avoidColor);
      if (item.tmBlockedProductIds !== undefined) existing.tmBlockedProductIds = normalizeTmBlocked(item.tmBlockedProductIds);
      if (item.customBackgroundColor) existing.customBackgroundColor = item.customBackgroundColor;
      if (item.pngPath) existing.pngPath = item.pngPath;
      if (item.imagePath) existing.imagePath = item.imagePath;
      if (item.source) existing.source = item.source;
      if (item.type) existing.type = item.type;
      if (item.designId) existing.designId = item.designId;
      if (item.publishedProductsCount !== undefined) existing.publishedProductsCount = item.publishedProductsCount;
      if (item.liveStats !== undefined) existing.liveStats = item.liveStats;
      if (item.liveProductSummary !== undefined) existing.liveProductSummary = item.liveProductSummary;
      if (item.liveProductTypes !== undefined) existing.liveProductTypes = item.liveProductTypes;

      this.saveQueue();
      this.rebalanceQueue();
      return existing;
    }

    const catalog = ProductCatalogService.getCatalog();
    const cleanBlockedList = normalizeTmBlocked(item.tmBlockedProductIds);
    const tmBlocked = new Set(cleanBlockedList.map(id => id.toUpperCase()));
    
    // Build initial activeProductsMap with non-blocked products and compute exact net slots
    const activeProductsMap: Record<string, string[]> = {};
    let totalBaseSlots = 0;

    const liveSummary = item.liveProductSummary || item.liveStats?.productSummary || {};
    const hasLiveDetail = Object.keys(liveSummary).length > 0;

    if (isUpdate && hasLiveDetail) {
      for (const prod of catalog.products) {
        if (prod.available === false) continue;
        if (tmBlocked.has(prod.id.toUpperCase())) continue;
        const prodId = prod.id;
        const catalogMps = (Array.isArray(prod.availableMarketplaces) ? prod.availableMarketplaces : ['US']).map(normalizeMarketplaceCode);

        // Find live summary for this product using canonical normalization
        const normProdId = normalizeCatalogProductId(prodId);
        const matchedSummaryKey = Object.keys(liveSummary).find(k => 
          normalizeCatalogProductId(k) === normProdId
        );
        const liveProductInfo = matchedSummaryKey ? liveSummary[matchedSummaryKey] : null;

        let liveMps: string[] = [];
        if (liveProductInfo) {
          if (Array.isArray(liveProductInfo.marketplaces)) {
            liveMps = liveProductInfo.marketplaces.map(normalizeMarketplaceCode);
          } else if (Array.isArray(liveProductInfo)) {
            liveMps = liveProductInfo.map(normalizeMarketplaceCode);
          }
        }

        // Exact delta of missing marketplaces to be published
        const missingMps = catalogMps.filter(mp => !liveMps.includes(mp));
        activeProductsMap[prod.id] = missingMps;
        totalBaseSlots += missingMps.length;
      }
    } else {
      for (const prod of catalog.products) {
        if (prod.available === false) continue;
        if (tmBlocked.has(prod.id.toUpperCase())) continue;
        const mps = (Array.isArray(prod.availableMarketplaces) ? prod.availableMarketplaces : ['US']).map(normalizeMarketplaceCode);
        activeProductsMap[prod.id] = mps;
        totalBaseSlots += mps.length;
      }
    }

    const alreadyPublished = item.publishedProductsCount ?? item.liveStats?.publishedCount ?? 0;
    const netSlots = (isUpdate && !hasLiveDetail) ? Math.max(0, totalBaseSlots - alreadyPublished) : totalBaseSlots;

    const newItem: QueueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      taskId: item.taskId,
      designTitle: item.designTitle,
      niche: item.niche || '',
      brand: item.brand || 'MBA Hub Studio',
      title: item.title || item.designTitle,
      bullet1: item.bullet1 || '',
      bullet2: item.bullet2 || '',
      description: item.description || '',
      listings: item.listings || {
        en: {
          brand: item.brand || 'MBA Hub Studio',
          title: item.title || item.designTitle,
          bullet1: item.bullet1 || '',
          bullet2: item.bullet2 || '',
          description: item.description || ''
        }
      },
      fitTypes: normalizeFitTypes(item.fitTypes),
      avoidColor: normalizeAvoidColor(item.avoidColor),
      customBackgroundColor: item.customBackgroundColor,
      imagePath: item.imagePath,
      pngPath: item.pngPath,
      resizedAssets: item.resizedAssets,
      addedAt: new Date().toISOString(),
      status: 'WAITING',
      isLocked: false,
      allocatedSlots: netSlots,
      totalBaseSlots: netSlots,
      activeProductsMap,
      droppedSlotsMap: {},
      tmBlockedProductIds: cleanBlockedList,
      sortOrder: this.items.length,
      source: item.source || (isUpdate ? 'UPDATE' : 'NEW'),
      type: item.type || (isUpdate ? 'update' : 'new'),
      designId: item.designId,
      publishedProductsCount: item.publishedProductsCount,
      liveStats: item.liveStats,
      liveProductSummary: item.liveProductSummary || item.liveStats?.productSummary || null,
      liveProductTypes: item.liveProductTypes || item.liveStats?.productTypes || null
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
    resizedAssets?: {
      trimmedPath?: string;
      mugStandardPath?: string;
      mugBrushPath?: string;
      drinkwareStandardPath?: string;
      drinkwareBrushPath?: string;
      productVariants?: Record<string, string>;
    };
    tmBlockedProductIds?: string[];
    source?: string;
    type?: 'new' | 'update';
    designId?: string;
    publishedProductsCount?: number;
    liveStats?: any;
    liveProductSummary?: Record<string, any>;
    liveProductTypes?: string[];
  }): QueueItem {
    return this.enqueueDesign({
      ...item,
      designTitle: item.designTitle || item.title || 'Design #' + item.taskId
    });
  }

  /**
   * Update item status during upload (UPLOADING, COMPLETED, ERROR)
   */
  public static updateItemStatus(queueId: string, status: QueueItemStatus, error?: string, uploadResultSummary?: UploadResultSummary): QueueItem | null {
    this.ensureLoaded();
    const item = this.items.find(i => i.id === queueId);
    if (!item) return null;

    item.status = status;
    item.lastUploadAttempt = new Date().toISOString();
    if (uploadResultSummary) {
      item.uploadResultSummary = uploadResultSummary;
    }
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

    const [removedItem] = this.items.splice(index, 1);
    // Re-index sortOrder
    this.items.forEach((item, idx) => {
      item.sortOrder = idx;
    });

    this.saveQueue();
    this.rebalanceQueue();

    // If removed item was an update item or associated with a task, cancel the task in TaskRepository
    try {
      const targetTaskId = removedItem.taskId || removedItem.id;
      const targetDesignId = removedItem.designId;
      TaskRepository.cancelTasksByTarget(targetTaskId, targetDesignId);
    } catch (e) {}

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
   * Knapsack / Subset-Sum Best-Fit Solver for Update Designs:
   * Finds the optimal combination of update designs from the pool that maximizes
   * utilized slots up to the available capacity without dropping products from any update design.
   * 0-slot designs are ALWAYS included for free.
   */
  public static solveBestFitUpdateKnapsack(
    candidates: QueueItem[], 
    capacity: number
  ): { selectedIds: Set<string>; usedSlots: number } {
    const selectedIds = new Set<string>();
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { selectedIds, usedSlots: 0 };
    }

    // 1. Separate 0-slot updates (always included for free) from positive-slot updates
    const zeroSlotItems: QueueItem[] = [];
    const positiveSlotItems: QueueItem[] = [];

    for (const item of candidates) {
      const slots = item.totalBaseSlots ?? 0;
      if (slots <= 0) {
        zeroSlotItems.push(item);
        selectedIds.add(item.id);
      } else {
        positiveSlotItems.push(item);
      }
    }

    if (capacity <= 0 || positiveSlotItems.length === 0) {
      return { selectedIds, usedSlots: 0 };
    }

    // 2. Dynamic Programming Subset-Sum (0/1 Knapsack)
    // dp[w] stores array of items that sum to weight w
    const dp: Array<QueueItem[] | null> = new Array(capacity + 1).fill(null);
    dp[0] = [];

    for (const item of positiveSlotItems) {
      const itemWeight = item.totalBaseSlots;
      if (itemWeight > capacity) continue;

      for (let w = capacity; w >= itemWeight; w--) {
        const prevCombination = dp[w - itemWeight];
        if (prevCombination !== null) {
          const newCombination = [...prevCombination, item];
          const currentCombinationAtW = dp[w];

          // If no combination yet at w, or if new combination has more items (tie-breaking: update more designs)
          if (currentCombinationAtW === null || newCombination.length > currentCombinationAtW.length) {
            dp[w] = newCombination;
          }
        }
      }
    }

    // 3. Find the highest weight <= capacity that has a valid combination
    let bestWeight = 0;
    let bestCombination: QueueItem[] = [];

    for (let w = capacity; w >= 0; w--) {
      if (dp[w] !== null) {
        bestWeight = w;
        bestCombination = dp[w]!;
        break;
      }
    }

    // 4. Add best combination items to selectedIds
    for (const item of bestCombination) {
      selectedIds.add(item.id);
    }

    return { selectedIds, usedSlots: bestWeight };
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
        if (prod.available === false) continue;
        if (tmBlocked.has(prod.id.toUpperCase())) continue;
        const mps = (Array.isArray(prod.availableMarketplaces) ? prod.availableMarketplaces : ['US']).map(normalizeMarketplaceCode);
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
        if (prod.available === false) continue;
        if (tmBlocked.has(prod.id.toUpperCase())) continue;
        const mps = (Array.isArray(prod.availableMarketplaces) ? prod.availableMarketplaces : ['US']).map(normalizeMarketplaceCode);
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
          if (t?.payload?.productSummary) uItem.liveProductSummary = t.payload.productSummary;
          if (t?.payload?.productTypes) uItem.liveProductTypes = t.payload.productTypes;
        } else {
          // If already live on Amazon and backfilled before 109 products, default to previous full catalog (106)
          alreadyPublished = 106;
          uItem.publishedProductsCount = 106;
        }
      }

      const liveSummary = uItem.liveProductSummary || {};
      const hasLiveDetail = Object.keys(liveSummary).length > 0;

      let netSlots = 0;
      const calculatedActiveMap: Record<string, string[]> = {};

      if (hasLiveDetail) {
        for (const prod of catalog.products) {
          if (prod.available === false) continue;
          if (tmBlocked.has(prod.id.toUpperCase())) continue;
          const prodId = prod.id;
          const catalogMps = (Array.isArray(prod.availableMarketplaces) ? prod.availableMarketplaces : ['US']).map(normalizeMarketplaceCode);

          // 1. Find live summary for this product using canonical normalization
          const normProdId = normalizeCatalogProductId(prodId);
          const matchedSummaryKey = Object.keys(liveSummary).find(k => 
            normalizeCatalogProductId(k) === normProdId
          );
          const liveProductInfo = matchedSummaryKey ? liveSummary[matchedSummaryKey] : null;

          let liveMps: string[] = [];
          if (liveProductInfo) {
            if (Array.isArray(liveProductInfo.marketplaces)) {
              liveMps = liveProductInfo.marketplaces.map(normalizeMarketplaceCode);
            } else if (Array.isArray(liveProductInfo)) {
              liveMps = liveProductInfo.map(normalizeMarketplaceCode);
            }
          }

          // 2. Exact delta of missing marketplaces that need to be newly uploaded/added
          const missingMps = catalogMps.filter(mp => !liveMps.includes(mp));

          calculatedActiveMap[prod.id] = missingMps;
          netSlots += missingMps.length;
        }
      } else {
        netSlots = Math.max(0, baseCatalogSlots - (alreadyPublished ?? 0));
        for (const prod of catalog.products) {
          if (prod.available === false) continue;
          if (tmBlocked.has(prod.id.toUpperCase())) continue;
          calculatedActiveMap[prod.id] = (Array.isArray(prod.availableMarketplaces) ? prod.availableMarketplaces : ['US']).map(normalizeMarketplaceCode);
        }
      }

      uItem.activeProductsMap = calculatedActiveMap;
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
      // Prio 2: Fill remaining slots with Update Designs using Best-Fit Knapsack Optimization

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

      // Prio 2: Allocate remaining slots to Update Items using Best-Fit Knapsack
      const remainingSlotsForUpdates = Math.max(0, availableSlotsForWaiting - usedSlotsByNew);
      const knapsackResult = this.solveBestFitUpdateKnapsack(waitingUpdateItems, remainingSlotsForUpdates);

      for (const uItem of waitingUpdateItems) {
        if (knapsackResult.selectedIds.has(uItem.id)) {
          uItem.allocatedSlots = uItem.totalBaseSlots;
        } else {
          uItem.allocatedSlots = 0;
        }
      }
    } else if (isHybridMode) {
      // DRAFT-HYBRID MODE:
      // Prio 1 (Live): Update Designs uploaded LIVE (utilizing daily slots with Best-Fit Knapsack)
      // Prio 2 (Draft): New Designs uploaded as DRAFT (0 Amazon slots consumed)

      const knapsackResult = this.solveBestFitUpdateKnapsack(waitingUpdateItems, availableSlotsForWaiting);

      for (const uItem of waitingUpdateItems) {
        if (knapsackResult.selectedIds.has(uItem.id)) {
          uItem.allocatedSlots = uItem.totalBaseSlots;
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
