export type TaskSource = 'HERMES' | 'TEST' | 'DESIGNER' | 'UPDATE';
export type TaskSuffix = 'H' | 'T' | 'D' | 'U';

export type TaskStatus = 
  | 'RECEIVED'
  | 'PROCESSING'
  | 'PROMPT_READY'
  | 'GENERATING_IMAGE'
  | 'ANALYZING_DESIGN'
  | 'AWAITING_PRE_FLIGHT_REVIEW'
  | 'AWAITING_DESIGN_REVIEW'
  | 'GENERATING_LISTING'
  | 'CHECKING_TRADEMARKS'
  | 'AWAITING_TM_REVIEW'
  | 'TRANSLATING_LISTING'
  | 'VECTORIZING_DESIGN'
  | 'AWAITING_SVG_REVIEW'
  | 'AWAITING_RECOVERY_REVIEW'
  | 'UPDATE_EXTRACTED'
  | 'UPDATE_DOWNLOADING_ARTWORK'
  | 'UPDATE_ARTWORK_READY'
  | 'UPDATE_ANALYZED'
  | 'UPDATE_REWRITING'
  | 'UPDATE_REWRITTEN'
  | 'UPDATE_TM_CHECKED'
  | 'UPDATE_TRANSLATED'
  | 'UPDATE_QUEUED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'ERROR';

export type EventCategory = 'SYSTEM' | 'OPENROUTER' | 'TRADEMARK' | 'IDEOGRAM' | 'VECTORIZE' | 'ERROR';

export type CheckpointType = 'PRE_FLIGHT' | 'DESIGN_REVIEW' | 'TM_REVIEW' | 'SVG_REVIEW' | 'UPDATE_REVIEW' | 'RECOVERY_REVIEW';

export type EventType = 
  | 'INCOMING_PAYLOAD'
  | 'SESSION_START'
  | 'LLM_REQUEST'
  | 'LLM_RESPONSE'
  | 'IDEOGRAM_REQUEST'
  | 'IDEOGRAM_RESPONSE'
  | 'ANALYSIS_REQUEST'
  | 'ANALYSIS_RESPONSE'
  | 'TASK_HANDOFF'
  | 'LISTING_REQUEST'
  | 'LISTING_RESPONSE'
  | 'TM_CHECK_REQUEST'
  | 'TM_CHECK_RESPONSE'
  | 'TM_REFINE_REQUEST'
  | 'TM_REFINE_RESPONSE'
  | 'TRANSLATION_REQUEST'
  | 'TRANSLATION_RESPONSE'
  | 'TRANSLATION_SKIPPED'
  | 'VECTORIZE_REQUEST'
  | 'VECTORIZE_RESPONSE'
  | 'SVG_EDIT_REQUEST'
  | 'SVG_EDIT_RESPONSE'
  | 'SVG_AUDIT_REQUEST'
  | 'SVG_AUDIT_RESPONSE'
  | 'RESIZE_REQUEST'
  | 'RESIZE_RESPONSE'
  | 'RECOVERY_DETECTED'
  | 'RECOVERY_STARTED'
  | 'RECOVERY_ASSET_REUSED'
  | 'RECOVERY_STEP_RESTARTED'
  | 'RECOVERY_COMPLETED'
  | 'RECOVERY_ESCALATED'
  | 'RECOVERY_FAILED'
  | 'ERROR';

export interface EventMetadata {
  model?: string;
  provider?: string;
  latencyMs?: number;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  costUsd?: number;
}

export interface SessionEvent {
  timestamp: string;
  type: EventType;
  title: string;
  content: any;
  metadata?: EventMetadata;
  repeatCount?: number;
  lastRepeatedAt?: string;
}

export interface DesignTaskLog {
  id: string;
  counter: number;
  source: TaskSource;
  suffix: TaskSuffix;
  status: TaskStatus;
  checkpoint?: CheckpointType;
  receivedAt: string;
  updatedAt?: string;
  clientIp?: string;
  designId?: string;
  quote?: string;
  inQueue?: boolean;
  eventsCount?: number;
  payload: Record<string, any>;
  events: SessionEvent[];
  niche1?: string;
  niche2?: string;
  subniche?: string;
  hermesKeywords?: string[];
  keywords?: string[];
  blockedProducts?: string[];
  blockedNiceClasses?: number[];
  resultPrompt?: string;
  imageUrl?: string;
  localImagePath?: string;
  originalSvgUrl?: string;
  originalSvgPath?: string;
  svgUrl?: string;
  localSvgPath?: string;
  svgContent?: string;
  mbaPngUrl?: string;
  localMbaPngPath?: string;
  fourPanelImageUrl?: string;
  localFourPanelImagePath?: string;
  u4PreviewUrl?: string;
  localU4PreviewPath?: string;
  svgAuditResult?: any;
  analysisResult?: any;
  customAnswers?: {
    niche1?: string;
    niche2?: string;
    subniche?: string;
    audience?: string;
    avoidColor?: string;
    reuseBackground?: string;
    maxColors?: number;
    notes?: string;
  };
  listingResult?: any;
  trademarkCheckResult?: any;
  trademarkRefineResult?: any;
  resizedAssets?: {
    trimmedPath?: string;
    mugStandardPath?: string;
    mugBrushPath?: string;
    drinkwareStandardPath?: string;
    drinkwareBrushPath?: string;
  };
  hasError?: boolean;
  errorDetails?: string;
  recovery?: {
    recoveryAttempts: number;
    lastAttemptAt?: string;
    interruptedStatus?: TaskStatus;
    interruptedStep?: string;
    recoveryReason?: string;
    recoveredAt?: string;
    recoveredSuccessfully?: boolean;
    amazonDesignId?: string;
    verifiedRemoteStatus?: string;
    remoteVerificationResult?: RemoteVerificationResult;
  };
  trademarkWorkflowState?: TrademarkWorkflowState;
}

export type RemoteVerificationResult =
  | 'CONFIRMED_SUCCESS'
  | 'VERIFY_PENDING'
  | 'AMBIGUOUS'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'REMOTE_ERROR'
  | 'CONFIRMED_REJECTED_BEFORE_MUTATION';

export interface RemoteResponseInfo {
  receivedAt: string;
  httpStatus: number;
  result: 'SUCCESS' | 'VALIDATION_ERROR' | 'AUTH_ERROR' | 'RATE_LIMITED' | 'REMOTE_ERROR';
  amazonDesignId?: string;
  amazonStatus?: string;
}

export interface RemoteBaselineInfo {
  designId: string;
  status?: string;
  updatedDate?: string;
  fingerprint: string;
}

export interface RemoteVerificationAttempt {
  attempt: number;
  status: RemoteVerificationResult;
  timestamp: string;
  details?: string;
}

export interface RemoteVerificationInfo {
  status: RemoteVerificationResult;
  attempts: number;
  firstAttemptAt: string;
  lastAttemptAt: string;
  matchedDesignId?: string;
  details?: string;
  history?: RemoteVerificationAttempt[];
}

export interface UploadRecoveryHistoryEntry {
  attempt: number;
  phase: string;
  action?: 'PUBLISH' | 'SAVE_DRAFT';
  remoteRequestIntentAt?: string;
  result?: string;
  manualOverride?: 'FORCE_RETRY' | 'MARK_CONFIRMED' | 'CANCEL';
  overrideAt?: string;
  reason?: string;
}

export type TrademarkWorkflowPhase =
  | 'INITIAL_SCAN'
  | 'REFEREE'
  | 'REWRITE'
  | 'VERIFY'
  | 'COMPLETED'
  | 'ESCALATED';

export interface TrademarkWorkflowState {
  phase: TrademarkWorkflowPhase;
  rewriteAttemptsCompleted: number; // 0, 1, 2, 3 (strictly max 3 rewrites)
  currentListing: {
    brand: string;
    title: string;
    bullet1: string;
    bullet2: string;
    description: string;
  };
  forbiddenTermsForTask: string[];
  rewriteIterations: Array<{
    iteration: number;
    actionsTaken: string[];
    listing: {
      brand: string;
      title: string;
      bullet1: string;
      bullet2: string;
      description: string;
    };
    hitsFound: number;
  }>;
  lastRefereeResult?: any;
  lastVerifierResult?: any;
  blockedProducts?: string[];
  blockedNiceClasses?: number[];
  initialTrademarkHits?: any[];
  lastCheckedListing?: {
    brand: string;
    title: string;
    bullet1: string;
    bullet2: string;
    description: string;
  };
}

export type RetryStepType = 
  | 'LLM_REQUEST' 
  | 'IDEOGRAM_REQUEST' 
  | 'ANALYSIS_REQUEST' 
  | 'LISTING_REQUEST' 
  | 'PREFLIGHT_TM_REQUEST' 
  | 'TM_CHECK_REQUEST' 
  | 'TM_REFINE_REQUEST'
  | 'TRANSLATION_REQUEST'
  | 'VECTORIZE_REQUEST'
  | 'SVG_AUDIT_REQUEST'
  | 'RESIZE_REQUEST'
  | 'SVG_REVIEW'
  | 'UPDATE_U1_EXTRACT'
  | 'UPDATE_U2_ARTWORK'
  | 'UPDATE_U3_ANALYZE'
  | 'UPDATE_U4_REWRITE'
  | 'UPDATE_U5_TM_CHECK'
  | 'UPDATE_U6_TRANSLATE'
  | 'UPDATE_U6_5_RESIZE'
  | 'UPDATE_U7_ENQUEUE';

export interface TaskSummary {
  id: string;
  counter: number;
  source: TaskSource;
  suffix: TaskSuffix;
  status: TaskStatus;
  checkpoint?: CheckpointType;
  receivedAt: string;
  updatedAt?: string;
  quote?: string;
  niche1?: string;
  niche2?: string;
  subniche?: string;
  imageUrl?: string;
  hasError: boolean;
  errorDetails?: string;
  eventsCount: number;
  clientIp?: string;
  designId?: string;
  inQueue?: boolean;
}

export function toTaskSummary(task: DesignTaskLog): TaskSummary {
  const quote = task.payload?.title || task.payload?.quote || task.payload?.quote_or_phrase || task.payload?.text || undefined;
  const niche1 = task.niche1 || task.payload?.niche1 || undefined;
  const niche2 = task.niche2 || task.payload?.niche2 || undefined;
  const subniche = task.subniche || task.payload?.subniche || undefined;
  const designId = task.payload?.designId || undefined;
  const imageUrl = task.imageUrl || task.u4PreviewUrl || task.mbaPngUrl || undefined;
  const lastEvent = task.events && task.events.length > 0 ? task.events[task.events.length - 1] : undefined;

  return {
    id: task.id,
    counter: task.counter,
    source: task.source,
    suffix: task.suffix,
    status: task.status,
    checkpoint: task.checkpoint,
    receivedAt: task.receivedAt,
    updatedAt: lastEvent?.timestamp || task.receivedAt,
    quote,
    niche1,
    niche2,
    subniche,
    imageUrl,
    hasError: Boolean(task.hasError),
    errorDetails: task.errorDetails,
    eventsCount: Array.isArray(task.events) ? task.events.length : 0,
    clientIp: task.clientIp,
    designId,
    inQueue: task.inQueue
  };
}
