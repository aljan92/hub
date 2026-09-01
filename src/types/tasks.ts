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

export type CheckpointType = 'PRE_FLIGHT' | 'DESIGN_REVIEW' | 'TM_REVIEW' | 'SVG_REVIEW' | 'UPDATE_REVIEW';

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
  | 'VECTORIZE_REQUEST'
  | 'VECTORIZE_RESPONSE'
  | 'SVG_EDIT_REQUEST'
  | 'SVG_EDIT_RESPONSE'
  | 'SVG_AUDIT_REQUEST'
  | 'SVG_AUDIT_RESPONSE'
  | 'RESIZE_REQUEST'
  | 'RESIZE_RESPONSE'
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
}

export interface DesignTaskLog {
  id: string;
  counter: number;
  source: TaskSource;
  suffix: TaskSuffix;
  status: TaskStatus;
  checkpoint?: CheckpointType;
  receivedAt: string;
  clientIp?: string;
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
