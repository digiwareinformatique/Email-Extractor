/**
 * Frontend Client API for DigiWare Lead Extractor
 */
import { 
  LeadRecord, 
  DashboardMetrics, 
  LeadFilterOptions, 
  EnrichmentJobState, 
  SegmentDefinition, 
  LeadExportOptions 
} from '../types/lead';

async function safeFetchJson<T>(url: string, options?: RequestInit, defaultErrorMsg = 'Erreur réseau'): Promise<T> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      const isHtml = text.trim().startsWith('<');
      if (isHtml) {
        const error = new Error('SERVEUR_EN_COURS_DE_DEMARRAGE');
        (error as any).isTransient = true;
        throw error;
      }
      if (!res.ok) {
        throw new Error(`${defaultErrorMsg} (HTTP ${res.status})`);
      }
      throw new Error(`${defaultErrorMsg}: réponse non valide.`);
    }

    if (data && typeof data === 'object' && !data.success && data.error) {
      throw new Error(data.error);
    }
    return data;
  } catch (err: any) {
    if (err.isTransient || err.message === 'SERVEUR_EN_COURS_DE_DEMARRAGE') {
      throw err;
    }
    throw new Error(err.message || defaultErrorMsg);
  }
}

export const leadApi = {
  // 1. Dashboard Metrics
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    return safeFetchJson<DashboardMetrics>('/api/stats/dashboard', undefined, 'Erreur lors du chargement des statistiques');
  },

  // 2. Query Leads with Filters
  async getLeads(filters: LeadFilterOptions = {}): Promise<{ leads: LeadRecord[]; total: number }> {
    const params = new URLSearchParams();
    if (filters.search) params.append('search', filters.search);
    if (filters.emailFilter && filters.emailFilter !== 'all') params.append('emailFilter', filters.emailFilter);
    if (filters.websiteFilter && filters.websiteFilter !== 'all') params.append('websiteFilter', filters.websiteFilter);
    if (filters.sector && filters.sector !== 'all') params.append('sector', filters.sector);
    if (filters.city && filters.city !== 'all') params.append('city', filters.city);
    if (filters.regionGovernorate && filters.regionGovernorate !== 'all') params.append('regionGovernorate', filters.regionGovernorate);
    if (filters.confidenceLevel && filters.confidenceLevel !== 'all') params.append('confidenceLevel', filters.confidenceLevel);
    if (filters.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters.operator && filters.operator !== 'all') params.append('operator', filters.operator);
    if (filters.page) params.append('page', String(filters.page));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.sortBy) params.append('sortBy', filters.sortBy);
    if (filters.sortOrder) params.append('sortOrder', filters.sortOrder);

    return safeFetchJson<{ leads: LeadRecord[]; total: number }>(`/api/leads?${params.toString()}`, undefined, 'Erreur lors de la récupération des leads');
  },

  // 3. Get Single Lead with Sources
  async getLeadById(id: string): Promise<LeadRecord> {
    return safeFetchJson<LeadRecord>(`/api/leads/${id}`, undefined, 'Lead introuvable');
  },

  // 4. Import Leads
  async importLeads(rawNumbers: string | any[], sourceName: string = 'Import Manuel', autoStart: boolean = false, targetMetier?: string): Promise<any> {
    return safeFetchJson('/api/leads/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawNumbers, sourceName, autoStartEnrichment: autoStart, targetMetier })
    }, "Erreur lors de l'importation");
  },

  // 5. Transfer from other modules (WhatsApp Extractor / Email Extractor)
  async transferContacts(contacts: any[], sourceModule: 'whatsapp' | 'email'): Promise<{ success: boolean; addedCount: number }> {
    return safeFetchJson('/api/leads/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts, sourceModule })
    }, 'Erreur lors du transfert des contacts');
  },

  // 6. Enrich / Re-analyze Single Lead
  async enrichSingleLead(id: string, options?: { forceReinvestigate?: boolean; targetMetier?: string }): Promise<LeadRecord> {
    return safeFetchJson(`/api/leads/${id}/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        forceReinvestigate: options?.forceReinvestigate ?? true,
        targetMetier: options?.targetMetier
      })
    }, "Erreur lors de l'enrichissement");
  },

  // 7. Delete Lead
  async deleteLead(id: string): Promise<void> {
    await safeFetchJson(`/api/leads/${id}`, { method: 'DELETE' }, 'Erreur lors de la suppression');
  },

  // 8. Clear All Leads
  async clearAllLeads(): Promise<void> {
    await safeFetchJson('/api/leads/clear-all', { method: 'POST' }, 'Erreur lors de la réinitialisation');
  },

  // 9. Job Queue Controls & Re-analysis
  async getJobStatus(): Promise<EnrichmentJobState> {
    return safeFetchJson<EnrichmentJobState>('/api/jobs/status', undefined, 'Erreur lors de la lecture du job');
  },

  async startJob(options?: { targetScope?: 'all' | 'pending' | 'without_email' | 'no_result' | 'failed' | 'selected'; leadIds?: string[]; forceReinvestigate?: boolean }): Promise<EnrichmentJobState> {
    return safeFetchJson<EnrichmentJobState>('/api/jobs/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {})
    }, 'Erreur au démarrage du traitement');
  },

  async reanalyzeLeads(options: { targetScope: 'all' | 'without_email' | 'no_result' | 'failed' | 'selected'; leadIds?: string[]; forceReinvestigate?: boolean }): Promise<EnrichmentJobState> {
    return safeFetchJson<EnrichmentJobState>('/api/leads/reanalyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    }, 'Erreur lors de la relance de la ré-analyse');
  },

  async pauseJob(): Promise<EnrichmentJobState> {
    return safeFetchJson<EnrichmentJobState>('/api/jobs/pause', { method: 'POST' }, 'Erreur lors de la mise en pause');
  },

  async resumeJob(): Promise<EnrichmentJobState> {
    return safeFetchJson<EnrichmentJobState>('/api/jobs/resume', { method: 'POST' }, 'Erreur lors de la reprise');
  },

  async resetJob(): Promise<EnrichmentJobState> {
    return safeFetchJson<EnrichmentJobState>('/api/jobs/reset', { method: 'POST' }, 'Erreur lors de la réinitialisation du job');
  },

  async resetEnrichmentData(scope: 'all' | 'without_email' | 'no_result' | 'failed' | 'selected' = 'all', leadIds?: string[]): Promise<{ success: boolean; resetCount: number }> {
    return safeFetchJson('/api/leads/reset-enrichment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, leadIds })
    }, 'Erreur lors de la remise à zéro des données');
  },

  // 10. Segments
  async getSegments(): Promise<SegmentDefinition[]> {
    return safeFetchJson<SegmentDefinition[]>('/api/segments', undefined, 'Erreur lors du chargement des segments');
  },

  async saveSegment(segment: SegmentDefinition): Promise<void> {
    await safeFetchJson('/api/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(segment)
    }, "Erreur lors de l'enregistrement du segment");
  },

  // 11. Export Leads
  async exportCSV(options: LeadExportOptions): Promise<void> {
    const res = await fetch('/api/leads/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    if (!res.ok) throw new Error("Erreur lors de l'exportation CSV");
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digiware_leads_${options.type}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }
};
