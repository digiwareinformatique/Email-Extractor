/**
 * Frontend API Service for DigiWare WhatsApp Business Center
 */
import {
  BusinessConversation,
  ConversationMessage,
  CrmContact,
  MultiSegmentCampaign,
  MessageTemplate,
  WcProduct,
  LinkCenterLink,
  AiAgentConfig,
  BusinessActivityLog,
  BusinessCenterAnalytics,
  CrmList,
  CrmTag,
  CrmSegment,
  CrmContactsStats,
  CrmContactsPagedResponse
} from '../types/businessCenter';

const API_BASE = '/api/business-center';

export const businessCenterApi = {
  // 1. Conversations
  async getConversations(filters?: { search?: string; status?: string; tag?: string; assigned_to?: string }): Promise<BusinessConversation[]> {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.tag) params.append('tag', filters.tag);
    if (filters?.assigned_to) params.append('assigned_to', filters.assigned_to);

    const res = await fetch(`${API_BASE}/conversations?${params.toString()}`);
    if (!res.ok) throw new Error('Erreur lors du chargement des conversations');
    const data = await res.json();
    return data.conversations || [];
  },

  async getConversationDetails(id: string): Promise<{
    conversation: BusinessConversation;
    contact: CrmContact;
    messages: ConversationMessage[];
  }> {
    const res = await fetch(`${API_BASE}/conversations/${id}/messages`);
    if (!res.ok) throw new Error('Erreur lors du chargement des messages');
    return await res.json();
  },

  async sendMessage(conversationId: string, text: string, templateId?: string): Promise<{
    success: boolean;
    message: ConversationMessage;
    externalMessageId?: string;
  }> {
    const res = await fetch(`${API_BASE}/conversations/${conversationId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, templateId })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erreur lors de la transmission WhatsApp');
    }
    return data;
  },

  async updateConversationStatus(id: string, status: string): Promise<void> {
    const res = await fetch(`${API_BASE}/conversations/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Erreur lors de la mise à jour du statut');
  },

  async getAiSuggestion(conversationId: string): Promise<{ suggestion: string; product: string }> {
    const res = await fetch(`${API_BASE}/conversations/${conversationId}/ai-suggest`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Erreur génération suggestion IA');
    return await res.json();
  },

  // 2. CRM Contacts
  async getCrmContactsStats(): Promise<CrmContactsStats> {
    const res = await fetch(`${API_BASE}/crm/stats`);
    if (!res.ok) throw new Error('Erreur chargement statistiques CRM');
    const data = await res.json();
    return data.stats;
  },

  async getCrmContactsPaged(filters?: {
    search?: string;
    segment?: string;
    civility?: string;
    status?: string;
    whatsapp_status?: string;
    tag?: string;
    list_id?: string;
    page?: number;
    limit?: number;
  }): Promise<CrmContactsPagedResponse> {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    if (filters?.segment) params.append('segment', filters.segment);
    if (filters?.civility) params.append('civility', filters.civility);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.whatsapp_status) params.append('whatsapp_status', filters.whatsapp_status);
    if (filters?.tag) params.append('tag', filters.tag);
    if (filters?.list_id) params.append('list_id', filters.list_id);
    if (filters?.page !== undefined) params.append('page', String(filters.page));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));

    const res = await fetch(`${API_BASE}/crm/contacts?${params.toString()}`);
    if (!res.ok) throw new Error('Erreur chargement contacts CRM');
    return await res.json();
  },

  async getCrmContacts(filters?: {
    search?: string;
    segment?: string;
    civility?: string;
    status?: string;
    tag?: string;
    list_id?: string;
  }): Promise<CrmContact[]> {
    const res = await this.getCrmContactsPaged({ ...filters, limit: -1 });
    return res.contacts || [];
  },

  async getCrmContact(id: string): Promise<CrmContact> {
    const res = await fetch(`${API_BASE}/crm/contacts/${id}`);
    if (!res.ok) throw new Error('Contact introuvable');
    const data = await res.json();
    return data.contact;
  },

  async saveCrmContact(contact: Partial<CrmContact> & { phone: string }): Promise<CrmContact> {
    const method = contact.id ? 'PUT' : 'POST';
    const url = contact.id ? `${API_BASE}/crm/contacts/${contact.id}` : `${API_BASE}/crm/contacts`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contact)
    });
    if (!res.ok) throw new Error('Erreur enregistrement contact');
    const data = await res.json();
    return data.contact;
  },

  async deleteCrmContact(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/crm/contacts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur suppression contact');
  },

  async bulkDeleteCrmContacts(ids: string[]): Promise<number> {
    const res = await fetch(`${API_BASE}/crm/contacts/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) throw new Error('Erreur suppression en masse');
    const data = await res.json();
    return data.deletedCount || 0;
  },

  async importCrmContacts(contacts: Partial<CrmContact>[]): Promise<{ imported: number; updated: number; total: number }> {
    const res = await fetch(`${API_BASE}/crm/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts })
    });
    if (!res.ok) throw new Error('Erreur importation contacts');
    return await res.json();
  },

  async syncLeadsToCrm(): Promise<{ synced: number; totalInCrm: number }> {
    const res = await fetch(`${API_BASE}/crm/sync-leads`, { method: 'POST' });
    if (!res.ok) throw new Error('Erreur synchronisation des leads');
    return await res.json();
  },

  async addContactNote(contactId: string, content: string, author?: string): Promise<void> {
    const res = await fetch(`${API_BASE}/crm/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, author })
    });
    if (!res.ok) throw new Error('Erreur ajout note');
  },

  // CRM Lists
  async getCrmLists(): Promise<CrmList[]> {
    const res = await fetch(`${API_BASE}/crm/lists`);
    if (!res.ok) throw new Error('Erreur chargement des listes');
    const data = await res.json();
    return data.lists || [];
  },

  async createCrmList(name: string, contactIds: string[] = [], description?: string): Promise<CrmList> {
    const res = await fetch(`${API_BASE}/crm/lists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contact_ids: contactIds, description })
    });
    if (!res.ok) throw new Error('Erreur création de la liste');
    const data = await res.json();
    return data.list;
  },

  async deleteCrmList(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/crm/lists/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur suppression de la liste');
  },

  async addContactsToList(listId: string, contactIds: string[]): Promise<CrmList> {
    const res = await fetch(`${API_BASE}/crm/lists/${listId}/add-contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: contactIds })
    });
    if (!res.ok) throw new Error('Erreur ajout contacts à la liste');
    const data = await res.json();
    return data.list;
  },

  async removeContactsFromList(listId: string, contactIds: string[]): Promise<CrmList> {
    const res = await fetch(`${API_BASE}/crm/lists/${listId}/remove-contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: contactIds })
    });
    if (!res.ok) throw new Error('Erreur retrait contacts de la liste');
    const data = await res.json();
    return data.list;
  },

  // CRM Tags
  async getCrmTags(): Promise<CrmTag[]> {
    const res = await fetch(`${API_BASE}/crm/tags`);
    if (!res.ok) throw new Error('Erreur chargement des tags');
    const data = await res.json();
    return data.tags || [];
  },

  async createCrmTag(name: string, color?: string): Promise<CrmTag> {
    const res = await fetch(`${API_BASE}/crm/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color })
    });
    if (!res.ok) throw new Error('Erreur création du tag');
    const data = await res.json();
    return data.tag;
  },

  async deleteCrmTag(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/crm/tags/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur suppression du tag');
  },

  async bulkTagContacts(contactIds: string[], tag: string, action: 'add' | 'remove' = 'add'): Promise<void> {
    const res = await fetch(`${API_BASE}/crm/contacts/bulk-tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: contactIds, tag, action })
    });
    if (!res.ok) throw new Error('Erreur attribution du tag');
  },

  // CRM Segments
  async getCrmSegments(): Promise<CrmSegment[]> {
    const res = await fetch(`${API_BASE}/crm/segments`);
    if (!res.ok) throw new Error('Erreur chargement des segments');
    const data = await res.json();
    return data.segments || [];
  },

  async createCrmSegment(code: string, name: string, description?: string, color?: string): Promise<CrmSegment> {
    const res = await fetch(`${API_BASE}/crm/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, description, color })
    });
    if (!res.ok) throw new Error('Erreur création du segment');
    const data = await res.json();
    return data.segment;
  },

  async deleteCrmSegment(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/crm/segments/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur suppression du segment');
  },

  async bulkSegmentContacts(contactIds: string[], segmentCode: string, action: 'add' | 'remove' = 'add'): Promise<void> {
    const res = await fetch(`${API_BASE}/crm/contacts/bulk-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: contactIds, segmentCode, action })
    });
    if (!res.ok) throw new Error('Erreur attribution du segment');
  },

  // WhatsApp Number Validation
  async checkContactWhatsApp(contactId: string, forceRecheck?: boolean, freshnessDays?: number): Promise<{
    contactId: string;
    phone: string;
    normalizedPhone: string;
    status: string;
    jid?: string;
    error?: string;
  }> {
    const res = await fetch(`${API_BASE}/crm/contacts/${contactId}/check-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRecheck, freshnessDays })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erreur lors de la vérification WhatsApp');
    }
    const data = await res.json();
    return data.result;
  },

  async startBatchWhatsAppValidation(
    contactIds: string[], 
    forceRecheck?: boolean, 
    concurrency?: number,
    freshnessDays?: number,
    delayMs?: number
  ): Promise<any> {
    const res = await fetch(`${API_BASE}/crm/contacts/check-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: contactIds, forceRecheck, concurrency, freshnessDays, delayMs })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erreur lors du démarrage de la validation par lot');
    }
    const data = await res.json();
    return data.job;
  },

  async startListWhatsAppValidation(
    listId: string,
    forceRecheck?: boolean,
    concurrency?: number,
    freshnessDays?: number,
    delayMs?: number
  ): Promise<any> {
    const res = await fetch(`${API_BASE}/crm/lists/${listId}/check-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceRecheck, concurrency, freshnessDays, delayMs })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erreur lors du démarrage de la validation de la liste');
    }
    const data = await res.json();
    return data.job;
  },

  async getWhatsAppValidationStatus(jobId: string): Promise<any> {
    const res = await fetch(`${API_BASE}/crm/whatsapp-validation/status/${jobId}`);
    if (!res.ok) throw new Error('Erreur récupération statut de validation');
    const data = await res.json();
    return data.job;
  },

  async cancelWhatsAppValidation(jobId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/crm/whatsapp-validation/cancel/${jobId}`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Erreur annulation validation');
    const data = await res.json();
    return data.cancelled;
  },

  // 3. Campaigns
  async getCampaigns(): Promise<MultiSegmentCampaign[]> {
    const res = await fetch(`${API_BASE}/campaigns`);
    if (!res.ok) throw new Error('Erreur chargement campagnes');
    const data = await res.json();
    return data.campaigns || [];
  },

  async saveCampaign(camp: Partial<MultiSegmentCampaign>): Promise<MultiSegmentCampaign> {
    const res = await fetch(`${API_BASE}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(camp)
    });
    if (!res.ok) throw new Error('Erreur enregistrement campagne');
    const data = await res.json();
    return data.campaign;
  },

  async prepareCampaign(id: string): Promise<{ campaign: MultiSegmentCampaign; totalPrepared: number }> {
    const res = await fetch(`${API_BASE}/campaigns/${id}/prepare`, { method: 'POST' });
    if (!res.ok) throw new Error('Erreur préparation campagne');
    return await res.json();
  },

  async launchCampaign(id: string): Promise<{ campaign: MultiSegmentCampaign; dispatched: number }> {
    const res = await fetch(`${API_BASE}/campaigns/${id}/launch`, { method: 'POST' });
    if (!res.ok) throw new Error('Erreur lancement campagne');
    return await res.json();
  },

  async pauseCampaign(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/campaigns/${id}/pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Erreur mise en pause');
  },

  async resumeCampaign(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/campaigns/${id}/resume`, { method: 'POST' });
    if (!res.ok) throw new Error('Erreur reprise');
  },

  async deleteCampaign(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/campaigns/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erreur suppression de la campagne');
  },

  // 4. Templates
  async getTemplates(): Promise<MessageTemplate[]> {
    const res = await fetch(`${API_BASE}/templates`);
    if (!res.ok) throw new Error('Erreur chargement templates');
    const data = await res.json();
    return data.templates || [];
  },

  async saveTemplate(tmpl: Partial<MessageTemplate>): Promise<MessageTemplate> {
    const res = await fetch(`${API_BASE}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tmpl)
    });
    if (!res.ok) throw new Error('Erreur enregistrement template');
    const data = await res.json();
    return data.template;
  },

  async previewTemplate(templateId?: string, templateContent?: string, contactId?: string): Promise<{ resolvedText: string; contactName: string }> {
    const res = await fetch(`${API_BASE}/templates/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, templateContent, contactId })
    });
    if (!res.ok) throw new Error('Erreur prévisualisation');
    return await res.json();
  },

  // 5. Products & Catalogue
  async getProducts(): Promise<WcProduct[]> {
    const res = await fetch(`${API_BASE}/products`);
    if (!res.ok) throw new Error('Erreur chargement produits');
    const data = await res.json();
    return data.products || [];
  },

  async updateProductCommercial(id: string, updates: Partial<WcProduct>): Promise<void> {
    const res = await fetch(`${API_BASE}/products/${id}/commercial`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Erreur mise à jour produit');
  },

  // 6. Link Center
  async getLinks(): Promise<LinkCenterLink[]> {
    const res = await fetch(`${API_BASE}/links`);
    if (!res.ok) throw new Error('Erreur chargement liens');
    const data = await res.json();
    return data.links || [];
  },

  async saveLink(link: Partial<LinkCenterLink>): Promise<LinkCenterLink> {
    const res = await fetch(`${API_BASE}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(link)
    });
    if (!res.ok) throw new Error('Erreur enregistrement lien');
    const data = await res.json();
    return data.link;
  },

  // 7. AI Agent
  async getAiConfig(): Promise<AiAgentConfig> {
    const res = await fetch(`${API_BASE}/ai-agent/config`);
    if (!res.ok) throw new Error('Erreur chargement config IA');
    const data = await res.json();
    return data.config;
  },

  async saveAiConfig(config: AiAgentConfig): Promise<void> {
    const res = await fetch(`${API_BASE}/ai-agent/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (!res.ok) throw new Error('Erreur enregistrement config IA');
  },

  // 8. Analytics
  async getAnalytics(): Promise<BusinessCenterAnalytics> {
    const res = await fetch(`${API_BASE}/analytics`);
    if (!res.ok) throw new Error('Erreur chargement analytics');
    const data = await res.json();
    return data.analytics;
  },

  // 9. Activity Logs
  async getActivityLogs(): Promise<BusinessActivityLog[]> {
    const res = await fetch(`${API_BASE}/activity-logs`);
    if (!res.ok) throw new Error('Erreur chargement journaux');
    const data = await res.json();
    return data.logs || [];
  },

  // 10. Integrations Status
  async getIntegrationsStatus(): Promise<any> {
    const res = await fetch(`${API_BASE}/integrations/status`);
    if (!res.ok) throw new Error('Erreur statut intégrations');
    const data = await res.json();
    return data.integrations;
  }
};
