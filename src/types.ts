export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface CriteriaScores {
  nameFound: boolean;
  emailValid: boolean;
  distanceScore: number; // 0 to 10 based on lines/character distance
  isCorporateDomain: boolean; // true if it's not gmail/yahoo/etc.
  hasSpamKeywords: boolean; // true if email contains admin/support/noreply
  isNameEmailMatch: boolean; // name looks similar to email prefix (e.g. John Doe & j.doe@)
  signaturePresent: boolean; // contact is found near a signature block
}

export interface ContactRecord {
  id: string;
  name: string;
  email: string;
  rawContext: string; // The text block where it was found
  confidenceScore: number; // 0 to 100
  confidenceLevel: ConfidenceLevel;
  criteriaScores: CriteriaScores;
  sourceFile: string;
  isEdited?: boolean;
}

export interface ExtractionStats {
  totalRecordsFound: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  averageScore: number;
  timeElapsedMs: number;
  fileSize: number;
  fileName: string;
}

export interface ExtractionResult {
  contacts: ContactRecord[];
  stats: ExtractionStats;
  cleanedTextSample?: string;
  fileAnalysis?: FileAnalysis;
}

export interface FileAnalysis {
  totalLines: number;
  nonEmptyLines: number;
  totalEmailsDetected: number;
  domainCounts: { domain: string; count: number }[];
  gmailCount: number;
  yahooCount: number;
  outlookCount: number;
  corporateCount: number;
  otherCount: number;
  averageLineLength: number;
  characterCount: number;
}

export interface ExtractionRequest {
  text: string;
  fileName: string;
  fileSize: number;
  aiEnhancement: boolean;
  filterSystemEmails: boolean;
}

// ==========================================
// WHATSAPP EXTRACTOR (TUNISIAN NUMBERS & NAMES)
// ==========================================

export type TunisianOperator = 'Ooredoo' | 'Orange' | 'Tunisie Telecom' | 'Lycamobile' | 'Fixe/VoIP' | 'Autre';
export type ScriptType = 'arabic' | 'latin' | 'mixed';

export interface WhatsAppCriteriaScores {
  validTunisianNumber: boolean;
  operatorDetected: boolean;
  nameFound: boolean;
  distanceScore: number; // 0 to 10 based on lines/character distance
  hasContextKeyword: boolean; // tel, whatsapp, gsm, هاتف, واتساب
  nameWordCount: number; // 1 word, 2+ words (first + last name)
  scriptType: ScriptType;
  isMobile: boolean;
}

export interface WhatsAppContactRecord {
  id: string;
  name: string;
  rawPhone: string; // The exact text matched in source
  cleanPhone: string; // Normalized 8-digit national number e.g. 22123456
  formattedNational: string; // e.g. 22 123 456
  formattedInternational: string; // e.g. +216 22 123 456
  waLink: string; // e.g. https://wa.me/21622123456
  operator: TunisianOperator;
  scriptType: ScriptType;
  rawContext: string; // The text window where the contact was detected
  confidenceScore: number; // 0 to 100
  confidenceLevel: ConfidenceLevel;
  criteriaScores: WhatsAppCriteriaScores;
  sourceFile: string;
  isEdited?: boolean;
}

export interface WhatsAppExtractionStats {
  totalRecordsFound: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  averageScore: number;
  timeElapsedMs: number;
  fileSize: number;
  fileName: string;
  arabicNamesCount: number;
  latinNamesCount: number;
}

export interface WhatsAppFileAnalysis {
  totalLines: number;
  nonEmptyLines: number;
  totalPhonesDetected: number;
  operatorDistribution: { operator: TunisianOperator; count: number }[];
  ooredooCount: number;
  orangeCount: number;
  ttCount: number;
  lycaCount: number;
  fixeCount: number;
  otherCount: number;
  arabicScriptCount: number;
  latinScriptCount: number;
  averageLineLength: number;
  characterCount: number;
}

export interface WhatsAppExtractionResult {
  contacts: WhatsAppContactRecord[];
  stats: WhatsAppExtractionStats;
  cleanedTextSample?: string;
  fileAnalysis?: WhatsAppFileAnalysis;
}

export interface WhatsAppExtractionRequest {
  text: string;
  fileName: string;
  fileSize: number;
  aiEnhancement: boolean;
  filterLandlines?: boolean;
  targetOperator?: 'all' | 'ooredoo' | 'orange' | 'tt' | 'lyca' | 'mobile_only';
}

