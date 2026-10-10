/**
 * Public Data Enrichment & Adaptive Search Engine Forwarder
 * STE DigiWare SUARL - Lead Extractor
 */
import { LeadRecord } from '../../../src/types/lead';
import { investigateAndEnrichLead } from '../../enrichment/adaptiveEngine';

export interface EnrichmentOptions {
  forceRefresh?: boolean;
  knownName?: string | null;
  knownContext?: string | null;
}

/**
 * Enriches a lead by Tunisian phone number using the Adaptive Investigation Engine
 */
export async function enrichLeadByPhone(
  rawPhone: string, 
  options: EnrichmentOptions = {}
): Promise<LeadRecord> {
  const existingLead: Partial<LeadRecord> = {};
  if (options.knownName) {
    existingLead.fullName = options.knownName;
  }
  if (options.knownContext) {
    existingLead.profession = options.knownContext;
  }

  return await investigateAndEnrichLead(rawPhone, existingLead);
}
