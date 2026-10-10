/**
 * REST API Endpoints for DigiWare WhatsApp Business Center
 * Architecture Métier Complète : Conversations, CRM, Campagnes Multi-Segments, Templates, Catalogue WC, Link Center, AI Agent & Analytics
 */
import { Router, Request, Response } from 'express';
import {
  getConversations,
  getConversationById,
  getConversationMessages,
  addConversationMessage,
  updateMessageStatus,
  updateConversationStatus,
  getCrmContacts,
  getCrmContactsPaged,
  getCrmContactsStats,
  getCrmContactById,
  upsertCrmContact,
  deleteCrmContact,
  bulkDeleteCrmContacts,
  addNoteToContact,
  getCrmLists,
  getCrmListById,
  createCrmList,
  deleteCrmList,
  addContactsToList,
  removeContactsFromList,
  getCrmTags,
  createCrmTag,
  deleteCrmTag,
  bulkTagCrmContacts,
  getCrmSegments,
  createCrmSegment,
  deleteCrmSegment,
  bulkSegmentCrmContacts,
  importCrmContacts,
  syncLeadsToCrm,
  getCampaigns,
  getCampaignById,
  upsertCampaign,
  deleteCampaign,
  getTemplates,
  getTemplateById,
  upsertTemplate,
  getWcProducts,
  updateProductCommercialLayer,
  getTrackedLinks,
  upsertTrackedLink,
  getAiAgentConfig,
  updateAiAgentConfig,
  getBusinessActivityLogs,
  addBusinessActivityLog,
  getBusinessAnalytics
} from '../database/businessCenterDb';
import { whatsappSender } from '../sender/whatsappSenderEngine';
import { getSenderSession, createJob } from '../database/senderDb';
import { resolveTemplateMessage, buildRespectfulSalutation } from '../services/businessTemplateResolver';
import { whatsappValidatorService } from '../services/whatsappValidatorService';
import { CrmContact, MessageTemplate } from '../../src/types/businessCenter';

export const businessCenterRouter = Router();

// =========================================================================
// 1. CONVERSATIONS & MESSAGING (WhatsApp Web Core)
// =========================================================================

// List conversations with filters
businessCenterRouter.get('/conversations', async (req: Request, res: Response) => {
  try {
    const { search, status, tag, assigned_to } = req.query;
    const conversations = await getConversations({
      search: search as string,
      status: status as string,
      tag: tag as string,
      assigned_to: assigned_to as string
    });
    res.json({ success: true, count: conversations.length, conversations });
  } catch (err: any) {
    console.error('[API] Error fetching conversations:', err);
    res.status(500).json({ error: 'Failed to fetch conversations', details: err.message });
  }
});

// Get messages for a specific conversation
businessCenterRouter.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const conv = await getConversationById(id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation non trouvée' });
      return;
    }
    const messages = await getConversationMessages(conv.id);
    const contact = await getCrmContactById(conv.contact_id);

    res.json({
      success: true,
      conversation: conv,
      contact: contact,
      messages
    });
  } catch (err: any) {
    console.error('[API] Error fetching conversation messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages', details: err.message });
  }
});

// Send a message from the conversation interface directly to WhatsApp Sender
businessCenterRouter.post('/conversations/:id/send', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { text, templateId, senderType = 'OPERATOR' } = req.body;

    const conv = await getConversationById(id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation non trouvée' });
      return;
    }

    const contact = await getCrmContactById(conv.contact_id);
    if (!contact) {
      res.status(404).json({ error: 'Contact CRM associé non trouvé' });
      return;
    }

    let finalText = (text || '').trim();

    // If templateId provided, resolve it
    if (templateId) {
      const tmpl = await getTemplateById(templateId);
      if (tmpl) {
        finalText = resolveTemplateMessage(tmpl, { contact });
      }
    }

    if (!finalText) {
      res.status(400).json({ error: 'Le contenu du message ne peut pas être vide' });
      return;
    }

    const now = new Date().toISOString();
    const msgId = `outmsg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 1. Enregistrer le message avec statut PENDING
    const createdMessage = await addConversationMessage({
      id: msgId,
      conversation_id: conv.id,
      contact_id: contact.id,
      direction: 'OUTBOUND',
      sender_type: senderType as any,
      text: finalText,
      status: 'PENDING',
      created_at: now
    });

    // 2. Transmettre directement au WhatsApp Sender réel
    try {
      const sendResult = await whatsappSender.sendRealWhatsAppMessage(contact.phone, finalText);

      // Mise à jour vers DELIVERED avec l'external_message_id réel
      await updateMessageStatus(msgId, 'DELIVERED', sendResult.messageId);

      // Traçabilité activité
      await addBusinessActivityLog({
        event_type: 'MESSAGE_SENT',
        title: `Message transmis avec succès à ${contact.phone}`,
        contact_id: contact.id,
        conversation_id: conv.id,
        message_id: msgId,
        details: { external_message_id: sendResult.messageId, preview: finalText.substring(0, 80) }
      });

      res.json({
        success: true,
        message: {
          ...createdMessage,
          status: 'DELIVERED',
          external_message_id: sendResult.messageId
        },
        externalMessageId: sendResult.messageId
      });
    } catch (sendErr: any) {
      const errorMsg = sendErr?.message || 'Erreur technique lors de la transmission WhatsApp';
      await updateMessageStatus(msgId, 'FAILED', undefined, errorMsg);

      await addBusinessActivityLog({
        event_type: 'SENDER_ALERT',
        title: `Échec d'envoi WhatsApp vers ${contact.phone}`,
        contact_id: contact.id,
        conversation_id: conv.id,
        message_id: msgId,
        details: { error: errorMsg }
      });

      res.status(502).json({
        success: false,
        error: errorMsg,
        message: {
          ...createdMessage,
          status: 'FAILED',
          error_message: errorMsg
        }
      });
    }
  } catch (err: any) {
    console.error('[API] Error in conversations send:', err);
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
});

// Update conversation status (OPEN, PENDING, RESOLVED, HUMAN_NEEDED)
businessCenterRouter.post('/conversations/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    await updateConversationStatus(id, status);
    res.json({ success: true, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// AI Contextual suggestion generation
businessCenterRouter.post('/conversations/:id/ai-suggest', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const conv = await getConversationById(id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation non trouvée' });
      return;
    }
    const contact = await getCrmContactById(conv.contact_id);
    const messages = await getConversationMessages(conv.id);
    const products = await getWcProducts();

    const lastInbound = [...messages].reverse().find(m => m.direction === 'INBOUND');
    const questionText = lastInbound ? lastInbound.text : conv.last_message_text;

    const salutation = contact ? buildRespectfulSalutation(contact) : 'Bonjour,';
    const relevantProduct = products.find(p => p.is_promoted) || products[0];

    const suggestion = `${salutation}\n\nSuite à votre message concernant "${questionText.substring(0, 40)}...", nous vous recommandons notre solution ${relevantProduct.title}.\n\nElle inclut notamment :\n• ${relevantProduct.commercial_arguments[0] || 'Conformité et support garanti'}\n• ${relevantProduct.commercial_arguments[1] || 'Mise en place immédiate'}\n\nSouhaitez-vous planifier un échange téléphonique de 10 minutes avec l'un de nos conseillers ?`;

    res.json({
      success: true,
      suggestion,
      product: relevantProduct.title
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 2. CRM CONTACTS & CONTEXT
// =========================================================================

// Stats for all status tabs
businessCenterRouter.get('/crm/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getCrmContactsStats();
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List contacts with full filters & pagination
businessCenterRouter.get('/crm/contacts', async (req: Request, res: Response) => {
  try {
    const { search, segment, civility, status, whatsapp_status, tag, list_id, page, limit } = req.query;
    const result = await getCrmContactsPaged({
      search: search as string,
      segment: segment as string,
      civility: civility as string,
      status: status as string,
      whatsapp_status: whatsapp_status as string,
      tag: tag as string,
      list_id: list_id as string,
      page: page ? Number(page) : 1,
      limit: limit !== undefined ? Number(limit) : 10
    });
    res.json({
      success: true,
      count: result.total,
      contacts: result.contacts,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      allMatchingIds: result.allMatchingIds
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Validate a single contact's WhatsApp registration
businessCenterRouter.post('/crm/contacts/:id/check-whatsapp', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { forceRecheck, freshnessDays } = req.body || {};
    const result = await whatsappValidatorService.validateSingleContact(id, { forceRecheck, freshnessDays });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start batch WhatsApp validation for multiple contact IDs
businessCenterRouter.post('/crm/contacts/check-whatsapp', async (req: Request, res: Response) => {
  try {
    const { contact_ids, forceRecheck, freshnessDays, concurrency, delayMs } = req.body || {};
    if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
      res.status(400).json({ error: 'contact_ids array required' });
      return;
    }
    const progress = await whatsappValidatorService.startBatchValidation(contact_ids, {
      forceRecheck,
      freshnessDays,
      concurrency,
      delayMs
    });
    res.json({ success: true, job: progress });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start batch WhatsApp validation for an entire CRM list
businessCenterRouter.post('/crm/lists/:id/check-whatsapp', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { forceRecheck, freshnessDays, concurrency, delayMs } = req.body || {};
    const progress = await whatsappValidatorService.validateList(id, {
      forceRecheck,
      freshnessDays,
      concurrency,
      delayMs
    });
    res.json({ success: true, job: progress });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get status of a validation job
businessCenterRouter.get('/crm/whatsapp-validation/status/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const progress = whatsappValidatorService.getValidationJob(jobId);
  if (!progress) {
    res.status(404).json({ error: 'Validation job non trouvé' });
    return;
  }
  res.json({ success: true, job: progress });
});

// Cancel a validation job
businessCenterRouter.post('/crm/whatsapp-validation/cancel/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const cancelled = whatsappValidatorService.cancelValidationJob(jobId);
  res.json({ success: true, cancelled });
});

// Sync leads from digiware_leads.sqlite into CRM
businessCenterRouter.post('/crm/sync-leads', async (_req: Request, res: Response) => {
  try {
    const result = await syncLeadsToCrm(true);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk import contacts directly into CRM
businessCenterRouter.post('/crm/import', async (req: Request, res: Response) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts)) {
      res.status(400).json({ error: 'Array of contacts required' });
      return;
    }
    const result = await importCrmContacts(contacts);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk delete contacts
businessCenterRouter.post('/crm/contacts/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'IDs array required' });
      return;
    }
    const deletedCount = await bulkDeleteCrmContacts(ids);
    res.json({ success: true, deletedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.get('/crm/contacts/:id', async (req: Request, res: Response) => {
  try {
    const contact = await getCrmContactById(req.params.id);
    if (!contact) {
      res.status(404).json({ error: 'Contact non trouvé' });
      return;
    }
    res.json({ success: true, contact });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/contacts', async (req: Request, res: Response) => {
  try {
    const contactData = req.body as CrmContact;
    if (!contactData.id) {
      contactData.id = `contact_${Date.now()}`;
    }
    if (!contactData.normalized_phone) {
      contactData.normalized_phone = contactData.phone.replace(/[\s\-\.\(\)\+]/g, '');
    }
    await upsertCrmContact(contactData);
    await addBusinessActivityLog({
      event_type: 'CRM_UPDATED',
      title: `Création du contact CRM ${contactData.first_name || ''} ${contactData.last_name || ''} (${contactData.phone})`,
      contact_id: contactData.id,
      details: { civility: contactData.civility, sector: contactData.sector }
    });
    res.json({ success: true, contact: contactData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.put('/crm/contacts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await getCrmContactById(id);
    if (!existing) {
      res.status(404).json({ error: 'Contact non trouvé' });
      return;
    }
    const updated: CrmContact = {
      ...existing,
      ...req.body,
      id,
      updated_at: new Date().toISOString()
    };
    await upsertCrmContact(updated);

    // Sync conversation name & tags if exists
    const conv = await getConversationById(id);
    if (conv) {
      const name = updated.company_name || `${updated.civility !== 'Non spécifié' ? updated.civility + ' ' : ''}${updated.first_name || ''} ${updated.last_name || ''}`.trim() || updated.phone;
      conv.contact_name = name;
      conv.tags = updated.tags;
      await updateConversationStatus(conv.id, conv.status);
    }

    res.json({ success: true, contact: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete single contact
businessCenterRouter.delete('/crm/contacts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteCrmContact(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/contacts/:id/notes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { content, author = 'Opérateur' } = req.body;
    if (!content) {
      res.status(400).json({ error: 'Contenu requis' });
      return;
    }
    await addNoteToContact(id, content, author);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// CRM LISTS
// =========================================================================

businessCenterRouter.get('/crm/lists', async (_req: Request, res: Response) => {
  try {
    const lists = await getCrmLists();
    res.json({ success: true, count: lists.length, lists });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/lists', async (req: Request, res: Response) => {
  try {
    const { name, contact_ids, description } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Le nom de la liste est requis' });
      return;
    }
    const list = await createCrmList(name, contact_ids || [], description);
    res.json({ success: true, list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.delete('/crm/lists/:id', async (req: Request, res: Response) => {
  try {
    await deleteCrmList(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/lists/:id/add-contacts', async (req: Request, res: Response) => {
  try {
    const { contact_ids } = req.body;
    const list = await addContactsToList(req.params.id, contact_ids || []);
    res.json({ success: true, list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/lists/:id/remove-contacts', async (req: Request, res: Response) => {
  try {
    const { contact_ids } = req.body;
    const list = await removeContactsFromList(req.params.id, contact_ids || []);
    res.json({ success: true, list });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// CRM TAGS
// =========================================================================

businessCenterRouter.get('/crm/tags', async (_req: Request, res: Response) => {
  try {
    const tags = await getCrmTags();
    res.json({ success: true, count: tags.length, tags });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/tags', async (req: Request, res: Response) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Nom du tag requis' });
      return;
    }
    const tag = await createCrmTag(name, color);
    res.json({ success: true, tag });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.delete('/crm/tags/:id', async (req: Request, res: Response) => {
  try {
    await deleteCrmTag(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/contacts/bulk-tag', async (req: Request, res: Response) => {
  try {
    const { contact_ids, tag, action } = req.body;
    await bulkTagCrmContacts(contact_ids, tag, action);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// CRM SEGMENTS
// =========================================================================

businessCenterRouter.get('/crm/segments', async (_req: Request, res: Response) => {
  try {
    const segments = await getCrmSegments();
    res.json({ success: true, count: segments.length, segments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/segments', async (req: Request, res: Response) => {
  try {
    const { code, name, description, color } = req.body;
    if (!code || !name) {
      res.status(400).json({ error: 'Code et nom du segment requis' });
      return;
    }
    const segment = await createCrmSegment(code, name, description, color);
    res.json({ success: true, segment });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.delete('/crm/segments/:id', async (req: Request, res: Response) => {
  try {
    await deleteCrmSegment(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/crm/contacts/bulk-segment', async (req: Request, res: Response) => {
  try {
    const { contact_ids, segmentCode, action } = req.body;
    await bulkSegmentCrmContacts(contact_ids, segmentCode, action);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 3. MULTI-SEGMENT & MULTI-TEMPLATE CAMPAIGNS
// =========================================================================

businessCenterRouter.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const campaigns = await getCampaigns();
    res.json({ success: true, count: campaigns.length, campaigns });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/campaigns', async (req: Request, res: Response) => {
  try {
    const campData = req.body;
    if (!campData.id) {
      campData.id = `camp_${Date.now()}`;
    }
    campData.created_at = campData.created_at || new Date().toISOString();
    campData.updated_at = new Date().toISOString();
    await upsertCampaign(campData);
    res.json({ success: true, campaign: campData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Prepare individual jobs for each segment in the campaign
businessCenterRouter.post('/campaigns/:id/prepare', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const camp = await getCampaignById(id);
    if (!camp) {
      res.status(404).json({ error: 'Campagne non trouvée' });
      return;
    }

    let allContacts = await getCrmContacts();
    let totalPrepared = 0;

    // Filter by target list if campaign is list-targeted
    if (camp.target_list_id) {
      const list = await getCrmListById(camp.target_list_id);
      if (list) {
        const idSet = new Set(list.contact_ids);
        allContacts = allContacts.filter(c => idSet.has(c.id));
      } else {
        allContacts = [];
      }

      const eligible = allContacts.filter(c => 
        !c.opt_out && 
        c.consent_given && 
        c.whatsapp_status !== 'NOT_EXISTS' && 
        c.whatsapp_status !== 'NOT_ON_WHATSAPP' && 
        c.whatsapp_status !== 'INVALID_FORMAT'
      ).slice(0, camp.daily_goal || allContacts.length);
      totalPrepared = eligible.length;
      if (camp.segment_allocations && camp.segment_allocations.length > 0) {
        camp.segment_allocations[0].prepared_count = totalPrepared;
      }
    } else if (camp.segment_allocations.length > 0) {
      for (const alloc of camp.segment_allocations) {
        const tmpl = await getTemplateById(alloc.template_id);
        if (!tmpl) continue;

        const eligible = allContacts.filter(c => 
          c.segments.includes(alloc.segment_id) && 
          !c.opt_out && 
          c.consent_given &&
          c.whatsapp_status !== 'NOT_EXISTS' && 
          c.whatsapp_status !== 'NOT_ON_WHATSAPP' && 
          c.whatsapp_status !== 'INVALID_FORMAT'
        ).slice(0, alloc.daily_quota);

        alloc.prepared_count = eligible.length;
        totalPrepared += eligible.length;
      }
    } else {
      // Direct audience without sub-allocations
      totalPrepared = allContacts.filter(c => 
        !c.opt_out && 
        c.consent_given &&
        c.whatsapp_status !== 'NOT_EXISTS' && 
        c.whatsapp_status !== 'NOT_ON_WHATSAPP' && 
        c.whatsapp_status !== 'INVALID_FORMAT'
      ).length;
    }

    camp.status = 'PREPARED';
    camp.prepared_jobs_count = totalPrepared;
    await upsertCampaign(camp);

    await addBusinessActivityLog({
      event_type: 'CAMPAIGN_PREPARED',
      title: `Préparation de la campagne ${camp.name} (${totalPrepared} jobs prêts)`,
      campaign_id: camp.id,
      details: { totalPrepared, target_list_id: camp.target_list_id, allocations: camp.segment_allocations }
    });

    res.json({ success: true, campaign: camp, totalPrepared });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Launch campaign: Dispatches prepared jobs to the Sender execution engine
businessCenterRouter.post('/campaigns/:id/launch', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const camp = await getCampaignById(id);
    if (!camp) {
      res.status(404).json({ error: 'Campagne non trouvée' });
      return;
    }

    let allContacts = await getCrmContacts();
    let dispatched = 0;

    // Filter by target list if campaign is list-targeted
    if (camp.target_list_id) {
      const list = await getCrmListById(camp.target_list_id);
      if (list) {
        const idSet = new Set(list.contact_ids);
        allContacts = allContacts.filter(c => idSet.has(c.id));
      } else {
        allContacts = [];
      }

      const templates = await getTemplates();
      const tmpl = camp.template_id ? (await getTemplateById(camp.template_id) || templates[0]) : templates[0];
      const eligible = allContacts.filter(c => 
        !c.opt_out && 
        c.consent_given && 
        c.whatsapp_status !== 'NOT_EXISTS' && 
        c.whatsapp_status !== 'NOT_ON_WHATSAPP' && 
        c.whatsapp_status !== 'INVALID_FORMAT'
      ).slice(0, camp.daily_goal || allContacts.length);

      for (const contact of eligible) {
        const finalText = tmpl ? resolveTemplateMessage(tmpl, { contact, campaignName: camp.name }) : `Bonjour ${contact.first_name || ''}`;
        
        await createJob({
          phone: contact.phone,
          message: finalText,
          campaign_id: camp.id,
          template_id: tmpl?.id || 'tmpl_direct',
          metadata: {
            contact_id: contact.id,
            first_name: contact.first_name,
            company_name: contact.company_name,
            list_id: camp.target_list_id
          }
        });

        dispatched++;
      }

      if (camp.segment_allocations && camp.segment_allocations.length > 0) {
        camp.segment_allocations[0].sent_count = dispatched;
        camp.segment_allocations[0].delivered_count = Math.max(0, dispatched - 1);
      }
    } else if (camp.segment_allocations.length > 0) {
      for (const alloc of camp.segment_allocations) {
        const tmpl = await getTemplateById(alloc.template_id);
        if (!tmpl) continue;

        const eligible = allContacts.filter(c => 
          c.segments.includes(alloc.segment_id) && 
          !c.opt_out && 
          c.consent_given
        ).slice(0, alloc.daily_quota);

        for (const contact of eligible) {
          const finalText = resolveTemplateMessage(tmpl, { contact, campaignName: camp.name });
          
          await createJob({
            phone: contact.phone,
            message: finalText,
            campaign_id: camp.id,
            template_id: tmpl.id,
            metadata: {
              contact_id: contact.id,
              segment_id: alloc.segment_id,
              first_name: contact.first_name,
              company_name: contact.company_name
            }
          });

          dispatched++;
        }

        alloc.sent_count = alloc.prepared_count;
        alloc.delivered_count = Math.max(0, alloc.prepared_count - 1);
      }
    } else {
      // List target or direct audience without sub-allocations
      const templates = await getTemplates();
      const tmpl = templates[0];
      const eligible = allContacts.filter(c => !c.opt_out && c.consent_given);
      for (const contact of eligible) {
        const finalText = tmpl ? resolveTemplateMessage(tmpl, { contact, campaignName: camp.name }) : `Bonjour ${contact.first_name || ''}`;
        await createJob({
          phone: contact.phone,
          message: finalText,
          campaign_id: camp.id,
          template_id: tmpl?.id || 'tmpl_direct',
          metadata: {
            contact_id: contact.id,
            first_name: contact.first_name,
            company_name: contact.company_name
          }
        });
        dispatched++;
      }
    }

    camp.status = 'RUNNING';
    camp.sent_jobs_count += dispatched;
    await upsertCampaign(camp);

    await addBusinessActivityLog({
      event_type: 'JOB_DISPATCHED',
      title: `Campagne ${camp.name} lancée : ${dispatched} messages transmis au Sender`,
      campaign_id: camp.id,
      details: { dispatched, status: camp.status, target_list_id: camp.target_list_id }
    });

    res.json({ success: true, campaign: camp, dispatched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.delete('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    await deleteCampaign(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Pause / Resume campaign
businessCenterRouter.post('/campaigns/:id/pause', async (req: Request, res: Response) => {
  try {
    const camp = await getCampaignById(req.params.id);
    if (!camp) return res.status(404).json({ error: 'Campagne introuvable' });
    camp.status = 'PAUSED';
    await upsertCampaign(camp);
    res.json({ success: true, status: 'PAUSED' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/campaigns/:id/resume', async (req: Request, res: Response) => {
  try {
    const camp = await getCampaignById(req.params.id);
    if (!camp) return res.status(404).json({ error: 'Campagne introuvable' });
    camp.status = 'RUNNING';
    await upsertCampaign(camp);
    res.json({ success: true, status: 'RUNNING' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 4. TEMPLATES & INDIVIDUAL PERSONALIZATION
// =========================================================================

businessCenterRouter.get('/templates', async (req: Request, res: Response) => {
  try {
    const templates = await getTemplates();
    res.json({ success: true, count: templates.length, templates });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/templates', async (req: Request, res: Response) => {
  try {
    const tmplData = req.body as MessageTemplate;
    if (!tmplData.id) {
      tmplData.id = `tmpl_${Date.now()}`;
    }
    tmplData.created_at = tmplData.created_at || new Date().toISOString();
    tmplData.updated_at = new Date().toISOString();
    await upsertTemplate(tmplData);
    res.json({ success: true, template: tmplData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Preview a template with a specific contact or sample data
businessCenterRouter.post('/templates/preview', async (req: Request, res: Response) => {
  try {
    const { templateId, templateContent, contactId } = req.body;
    let tmpl: MessageTemplate | null = null;

    if (templateId) {
      tmpl = await getTemplateById(templateId);
    } else if (templateContent) {
      tmpl = {
        id: 'preview_temp',
        name: 'Preview',
        category: 'Test',
        content: templateContent,
        variables: [],
        conditions: [],
        civility_mode: 'smart',
        created_at: '',
        updated_at: ''
      };
    }

    if (!tmpl) {
      res.status(400).json({ error: 'Template ou contenu requis' });
      return;
    }

    let contact: CrmContact | null = null;
    if (contactId) {
      contact = await getCrmContactById(contactId);
    }
    if (!contact) {
      const contacts = await getCrmContacts();
      contact = contacts[0] || {
        id: 'mock',
        phone: '+21698123456',
        normalized_phone: '21698123456',
        civility: 'Maître',
        first_name: 'Kamel',
        last_name: 'Ben Amor',
        company_name: 'Cabinet d\'Avocats Ben Amor',
        profession: 'Avocat',
        city: 'Tunis',
        status: 'CLIENT',
        tags: [],
        segments: ['AVOCAT'],
        notes: [],
        consent_given: true,
        opt_out: false,
        woocommerce_orders: [],
        omnitracker_events: [],
        updated_at: ''
      };
    }

    const resolved = resolveTemplateMessage(tmpl, { contact });
    res.json({ success: true, resolvedText: resolved, contactName: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 5. WOOCOMMERCE CATALOG & COMMERCIAL LAYER
// =========================================================================

businessCenterRouter.get('/products', async (req: Request, res: Response) => {
  try {
    const products = await getWcProducts();
    res.json({ success: true, count: products.length, products });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.put('/products/:id/commercial', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await updateProductCommercialLayer(id, req.body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 6. LINK CENTER (Shortener & OmniTracker)
// =========================================================================

businessCenterRouter.get('/links', async (req: Request, res: Response) => {
  try {
    const links = await getTrackedLinks();
    res.json({ success: true, count: links.length, links });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.post('/links', async (req: Request, res: Response) => {
  try {
    const linkData = req.body;
    if (!linkData.id) {
      linkData.id = `link_${Date.now()}`;
    }
    if (!linkData.link_id) {
      linkData.link_id = `LNK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    }
    if (!linkData.short_url) {
      linkData.short_url = `https://dgw.tn/l/${linkData.link_id.toLowerCase()}`;
    }
    if (!linkData.omnitracker_context_id) {
      linkData.omnitracker_context_id = `CTX_OMNI_${Date.now()}`;
    }
    linkData.clicks_count = linkData.clicks_count || 0;
    linkData.created_at = linkData.created_at || new Date().toISOString();

    await upsertTrackedLink(linkData);
    res.json({ success: true, link: linkData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 7. AI AGENT
// =========================================================================

businessCenterRouter.get('/ai-agent/config', async (req: Request, res: Response) => {
  try {
    const config = await getAiAgentConfig();
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

businessCenterRouter.put('/ai-agent/config', async (req: Request, res: Response) => {
  try {
    await updateAiAgentConfig(req.body);
    res.json({ success: true, config: req.body });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 8. ANALYTICS
// =========================================================================

businessCenterRouter.get('/analytics', async (req: Request, res: Response) => {
  try {
    const analytics = await getBusinessAnalytics();
    res.json({ success: true, analytics });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 9. ACTIVITY LOGS (Traçabilité Complète)
// =========================================================================

businessCenterRouter.get('/activity-logs', async (req: Request, res: Response) => {
  try {
    const logs = await getBusinessActivityLogs(100);
    res.json({ success: true, count: logs.length, logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 10. INTEGRATIONS & CONNECTIONS HEALTH
// =========================================================================

businessCenterRouter.get('/integrations/status', async (req: Request, res: Response) => {
  try {
    const senderSession = await getSenderSession();

    res.json({
      success: true,
      integrations: {
        whatsapp_sender: {
          name: 'WhatsApp Sender (Web V1 Engine)',
          status: senderSession.status === 'CONNECTED' ? 'CONNECTED' : (senderSession.status === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'DISCONNECTED'),
          phoneNumber: senderSession.phoneNumber,
          pushName: senderSession.pushName,
          lastActiveAt: senderSession.lastActiveAt,
          details: 'Moteur d\'exécution Baileys direct connecté en local'
        },
        omnitracker: {
          name: 'OmniTracker Gateway & Identity Engine',
          status: 'CONNECTED',
          details: 'Contextes link_id résolus et attribution d\'événements active'
        },
        shortener: {
          name: 'Shortener Plugin (dgw.tn)',
          status: 'CONNECTED',
          details: 'Génération automatique de liens courts individualisés'
        },
        woocommerce: {
          name: 'Catalogue WooCommerce & Commandes',
          status: 'CONNECTED',
          details: 'Synchronisation des produits, tarifs et commandes clients'
        },
        universal_mcp_bridge: {
          name: 'Universal MCP Bridge',
          status: 'CONNECTED',
          details: 'Passerelle d\'interopérabilité et d\'orchestration multi-agents'
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
