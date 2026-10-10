export type SenderJobStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'RETRY_PENDING';

export type SenderSessionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'AUTH_REQUIRED' | 'ERROR';

export type SenderLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface SenderJob {
  id: string; // e.g. "JOB-000123"
  contact_id?: string;
  phone: string;
  campaign_id?: string;
  template_id?: string;
  message: string;
  link_id?: string;
  metadata?: Record<string, any>;
  status: SenderJobStatus;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  result?: Record<string, any> | null;
  external_message_id?: string | null;
  delivery_ack?: 'sent' | 'delivered' | 'read' | 'held_undelivered' | 'pending_unconfirmed' | null;
}

export interface SenderSession {
  status: SenderSessionStatus;
  phoneNumber?: string | null;
  pushName?: string | null;
  platform: string;
  qrCode?: string | null;
  pairingCode?: string | null;
  lastActiveAt?: string | null;
  connectedAt?: string | null;
  errorMessage?: string | null;
  sessionDir?: string | null;
}

export interface SenderSettings {
  minDelaySeconds: number; // 45s default
  maxDelaySeconds: number; // 110s default
  dailyLimit: number; // 50 default for warm-up
  humanTypingSimulation: boolean;
  typingMinMs: number; // 150ms / char
  typingMaxMs: number; // 300ms / char
  spintaxEnabled: boolean;
  autoRetryTemporaryErrors: boolean;
  maxRetries: number;
  callbackWebhookUrl?: string;
  queuePaused: boolean;
  emergencyStopped: boolean;
}

export interface SenderMetrics {
  totalJobs: number;
  pendingCount: number;
  processingCount: number;
  sentCount: number;
  failedCount: number;
  cancelledCount: number;
  retryPendingCount: number;
  todaySentCount: number;
  dailyLimit: number;
  dailyRemaining: number;
  successRate: number;
  averageExecutionMs: number;
  isQueuePaused: boolean;
  emergencyStopped: boolean;
  blacklistedCount: number;
}

export interface SenderLog {
  id: string;
  jobId?: string | null;
  level: SenderLogLevel;
  event: string;
  message: string;
  details?: Record<string, any> | null;
  created_at: string;
}

export interface BlacklistEntry {
  phone: string;
  reason: string;
  sourceMessage?: string | null;
  created_at: string;
}

export interface CreateJobInput {
  job_id?: string;
  contact_id?: string;
  phone: string;
  campaign_id?: string;
  template_id?: string;
  message: string;
  link_id?: string;
  metadata?: Record<string, any>;
}

export interface BulkCreateJobsInput {
  jobs: CreateJobInput[];
  campaign_id?: string;
  template_id?: string;
}

export interface SenderFilterOptions {
  status?: SenderJobStatus | 'ALL';
  campaign_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}
