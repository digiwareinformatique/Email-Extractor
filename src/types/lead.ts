/**
 * Core Type Definitions for DigiWare Lead Extractor & Enrichment Engine
 * STE DigiWare SUARL - Lead Intelligence Architecture
 * 
 * Philosophy: PHONE -> IDENTITY -> DISCOVERY -> EMAIL
 */

export type LeadStatus = 
  | 'PENDING'
  | 'PROCESSING'
  | 'IDENTITY_FOUND'
  | 'DISCOVERY_IN_PROGRESS'
  | 'EMAIL_CANDIDATE'
  | 'EMAIL_FOUND'
  | 'EMAIL_CONFIRMED'
  | 'NO_RESULT'
  | 'NEEDS_VERIFICATION'
  | 'FAILED';

export type LeadConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'AMBIGUOUS';

export type EmailType = 
  | 'company_domain'    // e.g. mohamed@cabinet-benali.tn
  | 'personal_public'   // e.g. mohamed.benali@gmail.com
  | 'generic_org'       // e.g. contact@cabinet-benali.tn, info@...
  | 'isp_legacy'        // e.g. cabinet.benali@topnet.tn, gnet.tn
  | null;

export type LeadSourceType = 
  | 'official_website' 
  | 'contact_page' 
  | 'directory' 
  | 'search_snippet' 
  | 'public_registry'
  | 'facebook_page'
  | 'linkedin_profile'
  | 'instagram_profile'
  | 'pdf_document'
  | 'whatsapp_import'
  | 'email_import'
  | 'manual_input';

export interface LeadSourceRecord {
  id: string;
  leadId: string;
  fieldName: 'email' | 'companyName' | 'website' | 'address' | 'profession' | 'fullName' | 'phone';
  fieldValue: string;
  sourceUrl: string;
  sourceType: LeadSourceType;
  snippet?: string;
  foundAt: string;
}

export interface CandidateEmail {
  email: string;
  emailType: EmailType;
  score: number;                   // 0 to 100
  sources: string[];               // URLs or Source IDs
  verificationStatus: 'CANDIDATE' | 'VERIFIED' | 'REJECTED';
  corroborationCount: number;
  discoveredAt: string;
  reason?: string;
}

export interface DiscoveredIdentity {
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;           // e.g. Maître, Dr., Prof.
  confidence: number;
  source: string;
}

export interface DiscoveredProfession {
  profession: string;
  sector: string;                  // AVOCAT, COMPTABLE, etc.
  specialty?: string | null;
  confidence: number;
  source: string;
}

export interface DiscoveredLocation {
  city: string;
  regionGovernorate?: string | null;
  address?: string | null;
  source: string;
}

export interface DiscoveredOrganization {
  name: string;
  type?: string | null;            // Cabinet, SARL, SUARL, École, etc.
  source: string;
}

export interface DiscoveredDigitalAsset {
  type: 'facebook' | 'linkedin' | 'instagram' | 'website' | 'domain' | 'pdf';
  url: string;
  title?: string | null;
  source: string;
}

export interface DiscoveryItem {
  id: string;
  type: 'IDENTITY' | 'PROFESSION' | 'LOCATION' | 'ORGANIZATION' | 'DIGITAL_ASSET' | 'EMAIL' | 'PHONE';
  field: string;
  value: string;
  sourceUrl: string;
  sourceType: LeadSourceType;
  snippet?: string;
  confidence: number;
  timestamp: string;
}

export interface PriorityQueryItem {
  id: string;
  query: string;
  reason: string;
  sourceFamily: 
    | 'PHONE_LOOKUP' 
    | 'IDENTITY_SEARCH' 
    | 'FACEBOOK' 
    | 'LINKEDIN' 
    | 'INSTAGRAM' 
    | 'DOMAIN_AUDIT' 
    | 'EMAIL_SEARCH' 
    | 'PDF_DISCOVERY' 
    | 'CONFIRMATION';
  expectedValue: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  priority: number;                // Higher number = executed first (e.g. 100, 80, 50)
  prerequisites: string[];
  generatedFrom: string;
  status: 'PENDING' | 'EXECUTING' | 'DONE' | 'SKIPPED';
  resultsCount?: number;
  discoveriesCount?: number;
  executedAt?: string;
}

export interface SearchLogEntry {
  id: string;
  timestamp: string;
  type: 'SEARCH' | 'DISCOVERY' | 'QUERY_GENERATED' | 'VERIFICATION' | 'STOP' | 'WARNING' | 'CONFLICT';
  message: string;
  details?: Record<string, any>;
}

export interface LeadRecord {
  id: string;                         // e.g. DGR-000001
  rawPhone: string;                   // Original input
  normalizedPhone: string;            // +216XXXXXXXX
  nationalPhone: string;              // XX XXX XXX
  operator: string;                   // Ooredoo, Orange, Tunisie Telecom, Lycamobile, Fixe/VoIP, Autre
  
  // Primary Entity Fields
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  title?: string | null;              // Maître, Dr, etc.
  companyName: string | null;
  profession: string | null;
  primarySector: string;              // AVOCAT, COMPTABLE, ECOLE_PRIVEE, BUREAU_ETUDE, etc.
  segments: string[];
  address: string | null;
  city: string | null;
  regionGovernorate: string | null;
  
  // Primary Target
  email: string | null;               // Strictly verified pro email or best validated email
  emailType: EmailType;
  website: string | null;
  
  // Two distinct confidence scores (0 - 100)
  identityConfidence: number;         // 0 - 100
  emailConfidence: number;            // 0 - 100
  confidenceLevel: LeadConfidenceLevel;
  confidenceScore: number;            // Legacy backward-compat composite score
  status: LeadStatus;
  
  // Rich Structured Evidence Memory
  candidateEmails: CandidateEmail[];
  identities: DiscoveredIdentity[];
  professions: DiscoveredProfession[];
  locations: DiscoveredLocation[];
  organizations: DiscoveredOrganization[];
  digitalAssets: DiscoveredDigitalAsset[];
  discoveries: DiscoveryItem[];
  searches: PriorityQueryItem[];
  pendingQueries: PriorityQueryItem[];
  searchLogs: SearchLogEntry[];
  sources: LeadSourceRecord[];
  
  importBatchId?: string;
  targetMetier?: string;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentDefinition {
  id: string;
  code: string;                       // e.g. 'AVOCAT'
  label: string;                      // 'Avocats & Cabinets Juridiques'
  keywords: string[];
  keywordsFr?: string[];              // e.g. ['avocat', 'maître', 'cabinet d\'avocat']
  keywordsAr?: string[];              // e.g. ['محامي', 'الأستاذ', 'مكتب محاماة']
  isCustom: boolean;
  color?: string;
  sourcePacks?: string[];             // Preferred source types or directories
}

export interface EnrichmentJobState {
  id: string;
  totalLeads: number;
  processedLeads: number;
  enrichedCount: number;
  notFoundCount: number;
  ambiguousCount: number;
  failedCount: number;
  emailConfirmedCount: number;
  emailFoundCount: number;
  identityFoundCount: number;
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  currentLeadId: string | null;
  currentLeadPhone: string | null;
  currentQueryText?: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  speedLeadsPerMin?: number;
}

export interface DashboardMetrics {
  totalLeads: number;
  withEmail: number;
  withoutEmail: number;
  emailConfirmedCount: number;
  emailFoundCount: number;
  identityOnlyCount: number;
  withWebsite: number;
  partiallyEnriched: number;
  notFound: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  ambiguousCount: number;
  avgIdentityConfidence: number;
  avgEmailConfidence: number;
  sectorDistribution: { sector: string; count: number; label: string }[];
  governorateDistribution: { governorate: string; count: number }[];
  operatorDistribution: { operator: string; count: number }[];
}

export interface LeadFilterOptions {
  search?: string;
  emailFilter?: 'all' | 'with_email' | 'without_email' | 'confirmed_email' | 'candidate_email';
  websiteFilter?: 'all' | 'with_website' | 'without_website';
  sector?: string;
  city?: string;
  regionGovernorate?: string;
  confidenceLevel?: 'all' | 'HIGH' | 'MEDIUM' | 'LOW' | 'AMBIGUOUS';
  status?: 'all' | LeadStatus;
  operator?: string;
  page?: number;
  limit?: number;
  sortBy?: 'updatedAt' | 'confidenceScore' | 'identityConfidence' | 'emailConfidence' | 'fullName' | 'companyName' | 'city';
  sortOrder?: 'asc' | 'desc';
}

export interface LeadExportOptions {
  type: 'complete' | 'email_only' | 'phone_only' | 'by_segment' | 'needs_verification' | 'without_email' | 'custom';
  segmentCode?: string;
  columns?: string[];
  filterOptions?: LeadFilterOptions;
}
