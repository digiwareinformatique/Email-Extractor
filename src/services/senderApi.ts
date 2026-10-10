import {
  SenderJob,
  SenderSession,
  SenderSettings,
  SenderMetrics,
  SenderLog,
  BlacklistEntry,
  CreateJobInput,
  SenderFilterOptions
} from '../types/sender';

async function safeFetchJson<T>(url: string, options?: RequestInit, defaultErrorMsg = 'Erreur réseau'): Promise<T> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // If server returned HTML (e.g. dev server starting up or Vite index fallback)
      const isHtml = text.trim().startsWith('<');
      if (isHtml) {
        const error = new Error('SERVEUR_EN_COURS_DE_DEMARRAGE');
        (error as any).isTransient = true;
        throw error;
      }
      if (!res.ok) {
        throw new Error(`${defaultErrorMsg} (Serveur HTTP ${res.status})`);
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

export const senderApi = {
  async getStatus(): Promise<{
    session: SenderSession;
    metrics: SenderMetrics;
    settings: SenderSettings;
  }> {
    return safeFetchJson('/api/sender/status', undefined, 'Erreur lors de la récupération du statut');
  },

  async getJobs(options: SenderFilterOptions = {}): Promise<{
    jobs: SenderJob[];
    total: number;
  }> {
    const params = new URLSearchParams();
    if (options.status && options.status !== 'ALL') params.set('status', options.status);
    if (options.campaign_id) params.set('campaign_id', options.campaign_id);
    if (options.search) params.set('search', options.search);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));

    return safeFetchJson(`/api/sender/jobs?${params.toString()}`, undefined, 'Erreur lors de la récupération des jobs');
  },

  async getJobById(id: string): Promise<{
    job: SenderJob;
    logs: SenderLog[];
  }> {
    return safeFetchJson(`/api/sender/jobs/${id}`, undefined, 'Erreur lors de la consultation du job');
  },

  async createJob(input: CreateJobInput): Promise<{
    job: SenderJob;
    message: string;
  }> {
    return safeFetchJson('/api/sender/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }, 'Erreur lors de la création du job');
  },

  async createBulkJobs(jobs: CreateJobInput[], campaign_id?: string, template_id?: string): Promise<{
    created: number;
    jobIds: string[];
    message: string;
  }> {
    return safeFetchJson('/api/sender/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs, campaign_id, template_id })
    }, 'Erreur lors de l’envoi groupé vers la file');
  },

  async cancelJob(id: string): Promise<SenderJob> {
    const data = await safeFetchJson<{ success: boolean; job: SenderJob }>(
      `/api/sender/jobs/${id}/cancel`,
      { method: 'POST' },
      'Erreur lors de l’annulation'
    );
    return data.job;
  },

  async retryJob(id: string): Promise<SenderJob> {
    const data = await safeFetchJson<{ success: boolean; job: SenderJob }>(
      `/api/sender/jobs/${id}/retry`,
      { method: 'POST' },
      'Erreur lors de la relance'
    );
    return data.job;
  },

  async retryAllFailed(): Promise<number> {
    const data = await safeFetchJson<{ success: boolean; retriedCount: number }>(
      '/api/sender/jobs/bulk-retry',
      { method: 'POST' },
      'Erreur lors de la relance globale'
    );
    return data.retriedCount;
  },

  async pauseQueue(): Promise<boolean> {
    const data = await safeFetchJson<{ success: boolean; isQueuePaused: boolean }>(
      '/api/sender/queue/pause',
      { method: 'POST' },
      'Erreur lors de la mise en pause'
    );
    return data.isQueuePaused;
  },

  async resumeQueue(): Promise<boolean> {
    const data = await safeFetchJson<{ success: boolean; isQueuePaused: boolean }>(
      '/api/sender/queue/resume',
      { method: 'POST' },
      'Erreur lors de la reprise'
    );
    return data.isQueuePaused;
  },

  async clearFinished(): Promise<number> {
    const data = await safeFetchJson<{ success: boolean; deletedCount: number }>(
      '/api/sender/queue/clear',
      { method: 'POST' },
      'Erreur lors de la purge'
    );
    return data.deletedCount;
  },

  async testSend(phone: string, message: string): Promise<{
    success: boolean;
    job: SenderJob;
    logs: SenderLog[];
    message: string;
  }> {
    return safeFetchJson(
      '/api/sender/real-send-test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message })
      },
      'Erreur lors du test d’envoi'
    );
  },

  async sendRealTestMessage(phone: string, message = 'Test réel WhatsApp Sender.'): Promise<{
    success: boolean;
    messageId: string;
    phone: string;
    message: string;
    timestamp: string;
    job?: SenderJob;
    details?: any;
  }> {
    return safeFetchJson(
      '/api/sender/real-send-test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message })
      },
      'Erreur lors de l’envoi réel WhatsApp Web'
    );
  },


  // Emergency Stop Controls
  async triggerEmergencyStop(): Promise<void> {
    await safeFetchJson(
      '/api/sender/emergency-stop',
      { method: 'POST' },
      'Erreur lors du déclenchement de l’arrêt d’urgence'
    );
  },

  async resumeFromEmergencyStop(): Promise<void> {
    await safeFetchJson(
      '/api/sender/emergency-resume',
      { method: 'POST' },
      'Erreur lors de la reprise après arrêt d’urgence'
    );
  },

  // Blacklist Management
  async getBlacklist(): Promise<BlacklistEntry[]> {
    const data = await safeFetchJson<{ success: boolean; blacklist: BlacklistEntry[] }>(
      '/api/sender/blacklist',
      undefined,
      'Erreur lors du chargement de la blacklist'
    );
    return data.blacklist;
  },

  async addToBlacklist(phone: string, reason?: string): Promise<BlacklistEntry> {
    const data = await safeFetchJson<{ success: boolean; entry: BlacklistEntry }>(
      '/api/sender/blacklist',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, reason })
      },
      'Erreur lors de l’ajout en blacklist'
    );
    return data.entry;
  },

  async removeFromBlacklist(phone: string): Promise<void> {
    await safeFetchJson(
      `/api/sender/blacklist/${encodeURIComponent(phone)}`,
      { method: 'DELETE' },
      'Erreur lors de la suppression de la blacklist'
    );
  },

  // Opt-out / Reply Simulation
  async simulateReply(phone: string, message: string): Promise<{ isOptOut: boolean; blacklisted: boolean }> {
    const data = await safeFetchJson<{ success: boolean; result: { isOptOut: boolean; blacklisted: boolean } }>(
      '/api/sender/simulate-reply',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message })
      },
      'Erreur lors du test de message entrant'
    );
    return data.result;
  },

  // Spintax Preview
  async previewSpintax(template: string, count = 5): Promise<{ original: string; variations: string[] }> {
    return safeFetchJson(
      '/api/sender/spintax/preview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, count })
      },
      'Erreur lors de la génération des variations Spintax'
    );
  },

  // Session Management
  async connectSession(): Promise<SenderSession> {
    const data = await safeFetchJson<{ success: boolean; session: SenderSession }>(
      '/api/sender/session/connect',
      { method: 'POST' },
      'Erreur lors de la connexion'
    );
    return data.session;
  },

  async requestPairingCode(phoneNumber: string): Promise<{ pairingCode: string; session: SenderSession }> {
    return safeFetchJson<{ success: boolean; pairingCode: string; session: SenderSession }>(
      '/api/sender/session/pair',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      },
      'Erreur lors de la demande du code d\'association'
    );
  },

  async confirmSession(phoneNumber?: string, pushName?: string): Promise<SenderSession> {
    const data = await safeFetchJson<{ success: boolean; session: SenderSession }>(
      '/api/sender/session/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, pushName })
      },
      'Erreur lors de la confirmation'
    );
    return data.session;
  },

  async disconnectSession(): Promise<SenderSession> {
    const data = await safeFetchJson<{ success: boolean; session: SenderSession }>(
      '/api/sender/session/disconnect',
      { method: 'POST' },
      'Erreur lors de la déconnexion'
    );
    return data.session;
  },

  async getLogs(limit = 100, jobId?: string): Promise<SenderLog[]> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (jobId) params.set('jobId', jobId);

    const data = await safeFetchJson<{ success: boolean; logs: SenderLog[] }>(
      `/api/sender/logs?${params.toString()}`,
      undefined,
      'Erreur lors de la récupération des logs'
    );
    return data.logs;
  },

  async getSettings(): Promise<SenderSettings> {
    const data = await safeFetchJson<{ success: boolean; settings: SenderSettings }>(
      '/api/sender/settings',
      undefined,
      'Erreur lors de la lecture des paramètres'
    );
    return data.settings;
  },

  async updateSettings(partial: Partial<SenderSettings>): Promise<SenderSettings> {
    const data = await safeFetchJson<{ success: boolean; settings: SenderSettings }>(
      '/api/sender/settings',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial)
      },
      'Erreur lors de la mise à jour des paramètres'
    );
    return data.settings;
  }
};
