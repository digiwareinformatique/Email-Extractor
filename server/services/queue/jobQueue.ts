/**
 * Resilient Asynchronous Job Queue for Lead Enrichment & Discovery Engine
 * STE DigiWare SUARL - Lead Intelligence Platform
 */
import { getDatabase, upsertLead, getLeadById, resetLeadsForReanalysis } from '../../database/leadDb';
import { investigateAndEnrichLead } from '../../enrichment/adaptiveEngine';
import { EnrichmentJobState } from '../../../src/types/lead';

export interface QueueStartOptions {
  targetScope?: 'all' | 'pending' | 'without_email' | 'no_result' | 'failed' | 'selected';
  leadIds?: string[];
  forceReinvestigate?: boolean;
}

class LeadJobQueue {
  private currentJob: EnrichmentJobState = {
    id: 'job-default',
    totalLeads: 0,
    processedLeads: 0,
    enrichedCount: 0,
    notFoundCount: 0,
    ambiguousCount: 0,
    failedCount: 0,
    emailConfirmedCount: 0,
    emailFoundCount: 0,
    identityFoundCount: 0,
    status: 'IDLE',
    currentLeadId: null,
    currentLeadPhone: null,
    currentQueryText: null,
    startedAt: null,
    updatedAt: null,
    speedLeadsPerMin: 0
  };

  private pendingLeadIds: string[] = [];
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private startTime: number = 0;
  private forceReinvestigateMode: boolean = false;

  constructor() {
    this.restoreActiveJobFromDb();
  }

  private async restoreActiveJobFromDb() {
    try {
      const db = await getDatabase();
      const stmt = db.prepare("SELECT * FROM enrichment_jobs WHERE status IN ('RUNNING', 'PAUSED') ORDER BY updated_at DESC LIMIT 1");
      if (stmt.step()) {
        const row = stmt.getAsObject();
        this.currentJob = {
          id: String(row.id),
          totalLeads: Number(row.total_leads || 0),
          processedLeads: Number(row.processed_leads || 0),
          enrichedCount: Number(row.enriched_count || 0),
          notFoundCount: Number(row.not_found_count || 0),
          ambiguousCount: Number(row.ambiguous_count || 0),
          failedCount: Number(row.failed_count || 0),
          emailConfirmedCount: Number(row.email_confirmed_count || 0),
          emailFoundCount: Number(row.email_found_count || 0),
          identityFoundCount: Number(row.identity_found_count || 0),
          status: 'PAUSED', // Resume in paused state on server reboot
          currentLeadId: row.current_lead_id ? String(row.current_lead_id) : null,
          currentLeadPhone: row.current_lead_phone ? String(row.current_lead_phone) : null,
          currentQueryText: row.current_query_text ? String(row.current_query_text) : null,
          startedAt: row.started_at ? String(row.started_at) : null,
          updatedAt: row.updated_at ? String(row.updated_at) : null,
          speedLeadsPerMin: 0
        };
        console.log(`[JobQueue] Recovered unfinished job ${this.currentJob.id} (${this.currentJob.processedLeads}/${this.currentJob.totalLeads})`);
      }
      stmt.free();
    } catch (err) {
      console.error('[JobQueue] Failed to recover job from DB:', err);
    }
  }

  private async persistJobState() {
    try {
      const db = await getDatabase();
      const now = new Date().toISOString();
      this.currentJob.updatedAt = now;

      db.run(`
        INSERT OR REPLACE INTO enrichment_jobs (
          id, total_leads, processed_leads, enriched_count, not_found_count,
          ambiguous_count, failed_count, email_confirmed_count, email_found_count,
          identity_found_count, status, current_lead_id, current_lead_phone,
          current_query_text, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        this.currentJob.id,
        this.currentJob.totalLeads,
        this.currentJob.processedLeads,
        this.currentJob.enrichedCount,
        this.currentJob.notFoundCount,
        this.currentJob.ambiguousCount,
        this.currentJob.failedCount,
        this.currentJob.emailConfirmedCount || 0,
        this.currentJob.emailFoundCount || 0,
        this.currentJob.identityFoundCount || 0,
        this.currentJob.status,
        this.currentJob.currentLeadId,
        this.currentJob.currentLeadPhone,
        this.currentJob.currentQueryText || null,
        this.currentJob.startedAt,
        now
      ]);
    } catch (err) {
      console.error('[JobQueue] Error persisting job state:', err);
    }
  }

  public getStatus(): EnrichmentJobState {
    if (this.isRunning && this.startTime > 0 && this.currentJob.processedLeads > 0) {
      const elapsedMinutes = (Date.now() - this.startTime) / 60000;
      if (elapsedMinutes > 0.05) {
        this.currentJob.speedLeadsPerMin = Math.round(this.currentJob.processedLeads / elapsedMinutes);
      }
    }
    return { ...this.currentJob };
  }

  public async startQueue(options?: QueueStartOptions): Promise<EnrichmentJobState> {
    const db = await getDatabase();
    this.forceReinvestigateMode = options?.forceReinvestigate !== false;

    // Apply target scopes if requested and completely reset old results
    if (options?.targetScope && options.targetScope !== 'pending') {
      await resetLeadsForReanalysis(options.targetScope, options.leadIds);
    }

    if (this.isRunning) {
      return this.getStatus();
    }

    // Determine target lead IDs based on scope
    let selectSql = "SELECT id FROM leads WHERE status IN ('PENDING', 'PROCESSING') ORDER BY created_at ASC";
    const params: any[] = [];

    if (options?.targetScope === 'selected' && options.leadIds && options.leadIds.length > 0) {
      const placeholders = options.leadIds.map(() => '?').join(',');
      selectSql = `SELECT id FROM leads WHERE id IN (${placeholders}) ORDER BY created_at ASC`;
      params.push(...options.leadIds);
    } else if (options?.targetScope === 'without_email') {
      selectSql = "SELECT id FROM leads WHERE (email IS NULL OR email = '') ORDER BY created_at ASC";
    } else if (options?.targetScope === 'no_result') {
      selectSql = "SELECT id FROM leads WHERE status IN ('NO_RESULT', 'NOT_FOUND', 'AMBIGUOUS', 'FAILED', 'PENDING') ORDER BY created_at ASC";
    } else if (options?.targetScope === 'all') {
      selectSql = "SELECT id FROM leads ORDER BY created_at ASC";
    }

    const stmt = db.prepare(selectSql);
    stmt.bind(params);
    this.pendingLeadIds = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      this.pendingLeadIds.push(String(row.id));
    }
    stmt.free();

    if (this.pendingLeadIds.length === 0) {
      this.currentJob.status = 'COMPLETED';
      return this.getStatus();
    }

    this.currentJob.id = `job-${Date.now()}`;
    this.currentJob.totalLeads = this.pendingLeadIds.length;
    this.currentJob.processedLeads = 0;
    this.currentJob.enrichedCount = 0;
    this.currentJob.notFoundCount = 0;
    this.currentJob.ambiguousCount = 0;
    this.currentJob.failedCount = 0;
    this.currentJob.emailConfirmedCount = 0;
    this.currentJob.emailFoundCount = 0;
    this.currentJob.identityFoundCount = 0;
    this.currentJob.status = 'RUNNING';
    this.currentJob.startedAt = new Date().toISOString();
    this.startTime = Date.now();

    this.isRunning = true;
    this.isPaused = false;
    await this.persistJobState();

    this.processNextInQueue();
    return this.getStatus();
  }

  public async pauseQueue(): Promise<EnrichmentJobState> {
    this.isPaused = true;
    this.isRunning = false;
    this.currentJob.status = 'PAUSED';
    await this.persistJobState();
    return this.getStatus();
  }

  public async resumeQueue(): Promise<EnrichmentJobState> {
    if (this.isRunning) return this.getStatus();
    
    // If pending list is empty but job was paused, refill with remaining un-enriched leads
    if (this.pendingLeadIds.length === 0) {
      const db = await getDatabase();
      const stmt = db.prepare("SELECT id FROM leads WHERE status IN ('PENDING', 'PROCESSING') ORDER BY created_at ASC");
      this.pendingLeadIds = [];
      while (stmt.step()) {
        this.pendingLeadIds.push(String(stmt.getAsObject().id));
      }
      stmt.free();
    }

    this.isPaused = false;
    this.isRunning = true;
    this.currentJob.status = 'RUNNING';
    this.startTime = Date.now();
    await this.persistJobState();
    this.processNextInQueue();
    return this.getStatus();
  }

  public async resetQueue(): Promise<EnrichmentJobState> {
    this.isPaused = false;
    this.isRunning = false;
    this.pendingLeadIds = [];
    this.currentJob = {
      id: `job-${Date.now()}`,
      totalLeads: 0,
      processedLeads: 0,
      enrichedCount: 0,
      notFoundCount: 0,
      ambiguousCount: 0,
      failedCount: 0,
      emailConfirmedCount: 0,
      emailFoundCount: 0,
      identityFoundCount: 0,
      status: 'IDLE',
      currentLeadId: null,
      currentLeadPhone: null,
      currentQueryText: null,
      startedAt: null,
      updatedAt: null,
      speedLeadsPerMin: 0
    };
    await this.persistJobState();
    return this.getStatus();
  }

  private async processNextInQueue() {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    // Pop the next lead ID from the explicit FIFO queue
    const leadId = this.pendingLeadIds.shift();
    if (!leadId) {
      this.isRunning = false;
      this.currentJob.status = 'COMPLETED';
      this.currentJob.currentLeadId = null;
      this.currentJob.currentLeadPhone = null;
      this.currentJob.currentQueryText = null;
      await this.persistJobState();
      console.log('[JobQueue] Investigation queue finished all targeted leads.');
      return;
    }

    try {
      const existingLead = await getLeadById(leadId);
      if (!existingLead) {
        // Skip missing lead and continue
        this.processNextInQueue();
        return;
      }

      this.currentJob.currentLeadId = leadId;
      this.currentJob.currentLeadPhone = existingLead.nationalPhone || existingLead.rawPhone;
      this.currentJob.currentQueryText = `Démarrage de l'analyse adaptative...`;

      const db = await getDatabase();
      db.run("UPDATE leads SET status = 'PROCESSING', last_checked_at = ? WHERE id = ?", [new Date().toISOString(), leadId]);
      await this.persistJobState();

      // Execute Adaptive Investigation & Discovery Loop
      const enriched = await investigateAndEnrichLead(existingLead.rawPhone, existingLead, {
        forceReinvestigate: this.forceReinvestigateMode
      });
      enriched.id = leadId;

      // Update current query in UI for transparency
      if (enriched.searches && enriched.searches.length > 0) {
        const lastSearch = enriched.searches[enriched.searches.length - 1];
        this.currentJob.currentQueryText = lastSearch.query;
      }

      await upsertLead(enriched);

      // Update job counts
      this.currentJob.processedLeads++;
      if (enriched.status === 'EMAIL_CONFIRMED') {
        this.currentJob.emailConfirmedCount = (this.currentJob.emailConfirmedCount || 0) + 1;
        this.currentJob.enrichedCount++;
      } else if (enriched.status === 'EMAIL_FOUND' || enriched.status === 'EMAIL_CANDIDATE') {
        this.currentJob.emailFoundCount = (this.currentJob.emailFoundCount || 0) + 1;
        this.currentJob.enrichedCount++;
      } else if (enriched.status === 'IDENTITY_FOUND') {
        this.currentJob.identityFoundCount = (this.currentJob.identityFoundCount || 0) + 1;
        this.currentJob.enrichedCount++;
      } else if (enriched.status === 'NO_RESULT') {
        this.currentJob.notFoundCount++;
      } else if (enriched.status === 'FAILED') {
        this.currentJob.failedCount++;
      }

      await this.persistJobState();

      // Pacing interval between leads (300ms)
      setTimeout(() => {
        this.processNextInQueue();
      }, 300);

    } catch (err) {
      console.error(`[JobQueue] Error processing lead ${leadId}:`, err);
      this.currentJob.failedCount++;
      this.currentJob.processedLeads++;
      await this.persistJobState();

      setTimeout(() => {
        this.processNextInQueue();
      }, 400);
    }
  }
}

export const leadJobQueue = new LeadJobQueue();
