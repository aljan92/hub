export type TaskSource = 'HERMES' | 'TEST' | 'DESIGNER';
export type TaskSuffix = 'H' | 'T' | 'D';

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
  | 'VECTORIZING_DESIGN'
  | 'AWAITING_SVG_REVIEW'
  | 'COMPLETED'
  | 'REJECTED'
  | 'ERROR';

export type CheckpointType = 'PRE_FLIGHT' | 'DESIGN_REVIEW' | 'TM_REVIEW' | 'SVG_REVIEW';

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
  | 'VECTORIZE_REQUEST'
  | 'VECTORIZE_RESPONSE'
  | 'SVG_EDIT_REQUEST'
  | 'SVG_EDIT_RESPONSE'
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
  resultPrompt?: string;
  imageUrl?: string;
  localImagePath?: string;
  originalSvgUrl?: string;
  originalSvgPath?: string;
  svgUrl?: string;
  localSvgPath?: string;
  svgContent?: string;
  analysisResult?: any;
  customAnswers?: {
    audience?: string;
    avoidColor?: string;
    reuseBackground?: string;
    maxColors?: number;
    notes?: string;
  };
  listingResult?: any;
  trademarkCheckResult?: any;
  trademarkRefineResult?: any;
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
  | 'VECTORIZE_REQUEST'
  | 'SVG_REVIEW';
