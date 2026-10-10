/**
 * Type Definitions for DigiWare WhatsApp Business Center
 * Architecture Métier Unifiée
 */

export type CivilityType = 'Monsieur' | 'Madame' | 'Maître' | 'Docteur' | 'Autre' | 'Non spécifié';

export type WhatsAppValidationStatus = 
  | 'NOT_CHECKED' 
  | 'CHECKING' 
  | 'EXISTS' 
  | 'NOT_EXISTS'
  | 'NOT_ON_WHATSAPP' 
  | 'UNKNOWN'
  | 'INVALID_FORMAT' 
  | 'ERROR';

export interface WhatsAppValidationProgress {
  jobId: string;
  total: number;
  processed: number;
  existsCount: number;
  notExistsCount: number;
  notOnWaCount?: number;
  unknownCount: number;
  invalidCount: number;
  errorCount: number;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  results: {
    contactId: string;
    phone: string;
    status: WhatsAppValidationStatus;
    jid?: string;
    error?: string;
  }[];
}

export type ConversationStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'HUMAN_NEEDED';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export type MessageSenderType = 'OPERATOR' | 'AI' | 'CONTACT';

export type MessageDeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface BusinessConversation {
  id: string;
  contact_id: string;
  phone: string;
  contact_name: string;
  status: ConversationStatus;
  unread_count: number;
  last_message_text: string;
  last_message_at: string;
  assigned_to: 'HUMAN' | 'AI';
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  contact_id: string;
  direction: MessageDirection;
  sender_type: MessageSenderType;
  text: string;
  status: MessageDeliveryStatus;
  sender_job_id?: string;
  external_message_id?: string;
  created_at: string;
  error_message?: string;
  suggested_reply?: string;
}

export interface CrmNote {
  id: string;
  author: string;
  content: string;
  created_at: string;
}

export interface WcOrderSummary {
  id: string;
  number: string;
  total: string;
  date: string;
  status: string;
  products: string[];
}

export interface OmniTrackerEvent {
  id: string;
  event_name: string;
  timestamp: string;
  details: string;
}

export interface CrmContact {
  id: string;
  phone: string;
  normalized_phone: string;
  civility: CivilityType;
  professional_title?: string;
  preferred_salutation?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  profession?: string;
  address?: string;
  city?: string;
  sector?: string;
  email?: string;
  website?: string;
  status: 'PROSPECT' | 'LEAD' | 'CLIENT' | 'PARTENAIRE' | 'DÉSINSCRIT' | 'RELANCE' | 'REPONDU';
  tags: string[];
  segments: string[];
  notes: CrmNote[];
  consent_given: boolean;
  opt_out: boolean;
  woocommerce_orders: WcOrderSummary[];
  omnitracker_events: OmniTrackerEvent[];
  assigned_agent?: string;
  whatsapp_status?: WhatsAppValidationStatus;
  whatsapp_checked_at?: string;
  whatsapp_jid?: string;
  whatsapp_check_error?: string;
  updated_at: string;
}

export interface CrmList {
  id: string;
  name: string;
  description?: string;
  color?: string;
  contact_ids: string[];
  contact_count: number;
  created_at: string;
  updated_at: string;
}

export interface CrmTag {
  id: string;
  name: string;
  color?: string;
  count?: number;
  created_at?: string;
}

export interface CrmSegment {
  id: string;
  code: string;
  name: string;
  description?: string;
  color?: string;
  count?: number;
  created_at?: string;
}

export interface CrmContactsStats {
  total: number;
  clients: number;
  prospects: number;
  relance: number;
  opt_out: number;
  repondu: number;
  whatsapp_exists: number;
  whatsapp_not_on: number;
  whatsapp_not_checked: number;
  whatsapp_invalid: number;
  whatsapp_error: number;
}

export interface CrmContactsPagedResponse {
  contacts: CrmContact[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  allMatchingIds: string[];
}

export interface SegmentAllocation {
  segment_id: string;
  segment_name: string;
  template_id: string;
  template_name: string;
  daily_quota: number;
  prepared_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
}

export interface MultiSegmentCampaign {
  id: string;
  name: string;
  description: string;
  objective: string;
  status: 'DRAFT' | 'PREPARED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED';
  daily_goal: number;
  target_list_id?: string;
  target_list_name?: string;
  template_id?: string;
  template_name?: string;
  segment_allocations: SegmentAllocation[];
  exclusions: {
    exclude_recent_contact_days: number;
    exclude_opt_out: boolean;
    exclude_tags: string[];
  };
  prepared_jobs_count: number;
  sent_jobs_count: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateCondition {
  field: string;
  operator: 'filled' | 'empty' | 'equals';
  value?: string;
  output: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  category: string;
  content: string;
  variables: string[];
  conditions: TemplateCondition[];
  civility_mode: 'smart' | 'strict' | 'neutral';
  created_at: string;
  updated_at: string;
}

export interface WcProduct {
  id: string;
  sku: string;
  title: string;
  price: number;
  regular_price: number;
  sale_price?: number;
  stock_status: 'instock' | 'outofstock';
  categories: string[];
  description: string;
  image_url?: string;
  url: string;
  is_promoted: boolean;
  commercial_priority: 'HIGH' | 'MEDIUM' | 'LOW';
  commercial_arguments: string[];
  faq: { question: string; answer: string }[];
  cross_sells: string[];
}

export interface LinkCenterLink {
  id: string;
  link_id: string;
  title: string;
  destination_url: string;
  short_url: string;
  campaign_id?: string;
  segment_id?: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content?: string;
  utm_term?: string;
  omnitracker_context_id: string;
  clicks_count: number;
  last_clicked_at?: string;
  created_at: string;
}

export interface AiAgentConfig {
  mode: 'DISABLED' | 'SUGGESTION' | 'AUTO';
  identity_name: string;
  tone: 'professionnel' | 'chaleureux' | 'technique' | 'commercial';
  language: 'fr' | 'ar' | 'en';
  working_hours_start: string;
  working_hours_end: string;
  priority_product_ids: string[];
  allowed_sources: {
    woocommerce_products: boolean;
    woocommerce_faq: boolean;
    crm_lead_data: boolean;
    site_pages: boolean;
  };
  forbidden_topics: string[];
  human_handoff_keywords: string[];
  auto_reply_delay_seconds: number;
}

export interface BusinessCenterAnalytics {
  jobs_prepared: number;
  jobs_dispatched: number;
  messages_sent: number;
  messages_delivered: number;
  messages_failed: number;
  replies_received: number;
  conversations_open: number;
  links_clicked: number;
  attributed_conversions: number;
  response_time_avg_minutes: number;
}

export interface BusinessActivityLog {
  id: string;
  event_type: 'MESSAGE_SENT' | 'MESSAGE_RECEIVED' | 'CAMPAIGN_PREPARED' | 'JOB_DISPATCHED' | 'LINK_CLICKED' | 'AI_RESPONDED' | 'CRM_UPDATED' | 'SENDER_ALERT';
  title: string;
  contact_id?: string;
  conversation_id?: string;
  campaign_id?: string;
  segment_id?: string;
  template_id?: string;
  link_id?: string;
  job_id?: string;
  message_id?: string;
  details?: Record<string, any>;
  created_at: string;
}
