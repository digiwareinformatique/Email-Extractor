/**
 * REST API Routes for DigiWare Lead Extractor & Adaptive Enrichment Engine
 * STE DigiWare SUARL - Lead Intelligence Architecture
 */
import { Router, Request, Response } from 'express';
import { 
  getDatabase, 
  getLeads, 
  getLeadById, 
  upsertLead, 
  deleteLead, 
  clearAllLeads, 
  resetLeadsForReanalysis,
  getSegments, 
  saveSegment, 
  getDashboardMetrics,
  generateNextLeadId
} from '../database/leadDb';
import { normalizeTunisianPhone, getTunisianOperator } from '../services/normalization/phoneNormalizer';
import { investigateAndEnrichLead } from '../enrichment/adaptiveEngine';
import { leadJobQueue } from '../services/queue/jobQueue';
import { LeadRecord, LeadFilterOptions, LeadExportOptions } from '../../src/types/lead';

export const leadRouter = Router();

// 1. Dashboard Metrics
leadRouter.get('/stats/dashboard', async (req: Request, res: Response) => {
  try {
    const metrics = await getDashboardMetrics();
    res.json(metrics);
  } catch (err: any) {
    console.error('[API] Error fetching dashboard stats:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard metrics', details: err.message });
  }
});

// 2. Query Leads with Filters, Search & Pagination
leadRouter.get('/leads', async (req: Request, res: Response) => {
  try {
    const filters: LeadFilterOptions = {
      search: req.query.search as string,
      emailFilter: req.query.emailFilter as any,
      websiteFilter: req.query.websiteFilter as any,
      sector: req.query.sector as string,
      city: req.query.city as string,
      regionGovernorate: req.query.regionGovernorate as string,
      confidenceLevel: req.query.confidenceLevel as any,
      status: req.query.status as any,
      operator: req.query.operator as string,
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      sortBy: (req.query.sortBy as any) || 'updatedAt',
      sortOrder: (req.query.sortOrder as any) || 'desc'
    };

    const result = await getLeads(filters);
    res.json(result);
  } catch (err: any) {
    console.error('[API] Error querying leads:', err);
    res.status(500).json({ error: 'Failed to query leads', details: err.message });
  }
});

// 3. Get Single Lead with full audit sources and investigation graph
leadRouter.get('/leads/:id', async (req: Request, res: Response) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json(lead);
  } catch (err: any) {
    console.error('[API] Error fetching lead:', err);
    res.status(500).json({ error: 'Failed to fetch lead', details: err.message });
  }
});

// 4. Import Leads (CSV, TXT, raw phone list, JSON)
leadRouter.post('/leads/import', async (req: Request, res: Response) => {
  try {
    const { items, rawText, rawNumbers, sourceName, batchId, autoStartEnrichment, targetMetier } = req.body;
    const currentBatchId = batchId || (sourceName ? `batch-${sourceName.replace(/\s+/g, '_')}` : `batch-${Date.now()}`);
    const importedLeads: LeadRecord[] = [];
    let duplicatesSkipped = 0;
    let invalidCount = 0;

    const phonesToProcess: { rawPhone: string; name?: string; context?: string }[] = [];

    // Parse structured items array
    const sourceItems = Array.isArray(items) ? items : (Array.isArray(rawNumbers) ? rawNumbers : null);
    if (sourceItems) {
      for (const item of sourceItems) {
        if (typeof item === 'string') {
          phonesToProcess.push({ rawPhone: item });
        } else if (item && (item.phone || item.cleanPhone || item.rawPhone)) {
          phonesToProcess.push({
            rawPhone: String(item.phone || item.cleanPhone || item.rawPhone),
            name: item.name ? String(item.name) : undefined,
            context: item.context || item.profession || item.rawContext ? String(item.context || item.profession || item.rawContext) : undefined
          });
        }
      }
    }

    // Parse raw text (CSV or TXT line by line)
    const textToParse = typeof rawText === 'string' ? rawText : (typeof rawNumbers === 'string' ? rawNumbers : null);
    if (textToParse) {
      const lines = textToParse.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Check if CSV line: "phone,name,profession" or "phone;name;profession"
        const delimiter = trimmed.includes(';') ? ';' : (trimmed.includes('\t') ? '\t' : ',');
        const parts = trimmed.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));

        if (parts.length > 0) {
          const possiblePhone = parts[0];
          const possibleName = parts.length > 1 ? parts[1] : undefined;
          const possibleContext = parts.length > 2 ? parts[2] : undefined;

          phonesToProcess.push({
            rawPhone: possiblePhone,
            name: possibleName,
            context: possibleContext
          });
        }
      }
    }

    const seenPhonesInBatch = new Set<string>();

    for (const entry of phonesToProcess) {
      const norm = normalizeTunisianPhone(entry.rawPhone);
      if (!norm.isValid) {
        invalidCount++;
        continue;
      }

      if (seenPhonesInBatch.has(norm.clean8)) {
        duplicatesSkipped++;
        continue;
      }
      seenPhonesInBatch.add(norm.clean8);

      const op = getTunisianOperator(norm.clean8);
      const leadId = await generateNextLeadId();
      const now = new Date().toISOString();

      const newLead: LeadRecord = {
        id: leadId,
        rawPhone: entry.rawPhone,
        normalizedPhone: norm.e164,
        nationalPhone: norm.national,
        operator: op,
        firstName: null,
        lastName: null,
        fullName: entry.name || null,
        companyName: null,
        profession: entry.context || null,
        primarySector: targetMetier || 'INCONNU',
        targetMetier: targetMetier || undefined,
        segments: targetMetier ? [targetMetier] : ['INCONNU'],
        address: null,
        city: null,
        regionGovernorate: null,
        email: null,
        emailType: null,
        website: null,
        identityConfidence: entry.name ? 30 : 0,
        emailConfidence: 0,
        confidenceLevel: 'LOW',
        confidenceScore: entry.name ? 15 : 0,
        status: 'PENDING',
        candidateEmails: [],
        identities: entry.name ? [{
          fullName: entry.name,
          confidence: 50,
          source: 'Import'
        }] : [],
        professions: entry.context ? [{
          profession: entry.context,
          sector: 'INCONNU',
          confidence: 40,
          source: 'Import'
        }] : [],
        locations: [],
        organizations: [],
        digitalAssets: [],
        discoveries: [],
        searches: [],
        pendingQueries: [],
        searchLogs: [{
          id: `log-imp-${Date.now()}-${importedLeads.length}`,
          timestamp: now,
          type: 'SEARCH',
          message: `Lead importé depuis le lot ${currentBatchId}`
        }],
        sources: [{
          id: `src-imp-${Date.now()}-${importedLeads.length}`,
          leadId,
          fieldName: 'phone',
          fieldValue: norm.e164,
          sourceUrl: sourceName || 'Import Batch',
          sourceType: 'manual_input',
          foundAt: now
        }],
        importBatchId: currentBatchId,
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now
      };

      await upsertLead(newLead);
      importedLeads.push(newLead);
    }

    if (autoStartEnrichment && importedLeads.length > 0) {
      leadJobQueue.startQueue().catch((e) => console.error('[Queue] Auto-start error:', e));
    }

    res.json({
      success: true,
      importedCount: importedLeads.length,
      duplicateCount: duplicatesSkipped,
      duplicatesSkipped,
      invalidCount,
      batchId: currentBatchId
    });

  } catch (err: any) {
    console.error('[API] Error importing leads:', err);
    res.status(500).json({ error: 'Failed to import leads', details: err.message });
  }
});

// 5. Transfer Contacts from WhatsApp / Email Extractor Modules
leadRouter.post('/leads/transfer', async (req: Request, res: Response) => {
  try {
    const { contacts, sourceModule } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      res.json({ success: true, addedCount: 0 });
      return;
    }

    let addedCount = 0;
    const now = new Date().toISOString();
    const batchId = `transfer-${sourceModule || 'module'}-${Date.now()}`;

    for (const c of contacts) {
      if (!c) continue;

      let rawPhone = c.rawPhone || c.cleanPhone || c.formattedNational || c.formattedInternational || c.phone || c.phoneNumber || '';
      const email = c.email ? String(c.email).trim() : null;
      const fullName = c.name ? String(c.name).trim() : null;
      const context = c.rawContext || c.context || c.sourceFile || '';

      // If no direct phone but email/context exists, scan context for Tunisian phone numbers
      if (!rawPhone && context) {
        const phoneMatch = context.match(/(?:\+?216\s*)?[2345789]\d[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}|(?:\+?216\s*)?[2345789]\d{7}/);
        if (phoneMatch) {
          rawPhone = phoneMatch[0];
        }
      }

      // If still no phone, but email exists, generate a deterministic virtual number so the lead is saved
      if (!rawPhone && email) {
        const cleanEmailHash = Math.abs(email.split('').reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0)) % 10000000;
        rawPhone = `5${String(cleanEmailHash).padStart(7, '0')}`;
      }

      if (!rawPhone) continue;

      const norm = normalizeTunisianPhone(rawPhone);
      const phoneToUse = norm.isValid ? norm.e164 : (rawPhone.startsWith('+') ? rawPhone : `+216${rawPhone.replace(/\D/g, '')}`);
      const nationalToUse = norm.isValid ? norm.national : rawPhone;
      const op = norm.isValid ? getTunisianOperator(norm.clean8) : 'Autre';

      const leadId = await generateNextLeadId();

      const isEmailConfirmed = Boolean(email && email.includes('@'));
      const isPersonalMail = email ? (email.includes('@gmail') || email.includes('@yahoo') || email.includes('@hotmail') || email.includes('@outlook')) : false;
      const detectedEmailType = email ? (isPersonalMail ? 'personal_public' : 'company_domain') : null;

      const newLead: LeadRecord = {
        id: leadId,
        rawPhone: String(rawPhone),
        normalizedPhone: phoneToUse,
        nationalPhone: nationalToUse,
        operator: op,
        firstName: null,
        lastName: null,
        fullName: fullName || null,
        title: null,
        companyName: null,
        profession: null,
        primarySector: 'INCONNU',
        segments: ['INCONNU'],
        address: null,
        city: null,
        regionGovernorate: null,
        email: email || null,
        emailType: detectedEmailType,
        website: null,
        identityConfidence: fullName ? 70 : 30,
        emailConfidence: isEmailConfirmed ? 85 : 0,
        confidenceLevel: isEmailConfirmed ? 'HIGH' : (fullName ? 'MEDIUM' : 'LOW'),
        confidenceScore: isEmailConfirmed ? 85 : (fullName ? 50 : 20),
        status: isEmailConfirmed ? 'EMAIL_CONFIRMED' : (fullName ? 'IDENTITY_FOUND' : 'PENDING'),
        candidateEmails: isEmailConfirmed ? [{
          email: email!,
          emailType: detectedEmailType,
          score: 85,
          sources: [`Transfert ${sourceModule === 'whatsapp' ? 'WhatsApp Extractor' : 'Email Extractor'}`],
          verificationStatus: 'VERIFIED',
          corroborationCount: 1,
          discoveredAt: now,
          reason: `Transféré depuis le module ${sourceModule}`
        }] : [],
        identities: fullName ? [{
          fullName,
          confidence: 70,
          source: `Transfert ${sourceModule}`
        }] : [],
        professions: [],
        locations: [],
        organizations: [],
        digitalAssets: [],
        discoveries: [],
        searches: [],
        pendingQueries: [],
        searchLogs: [{
          id: `log-tr-${Date.now()}-${addedCount}`,
          timestamp: now,
          type: 'SEARCH',
          message: `Contact transféré depuis ${sourceModule === 'whatsapp' ? 'WhatsApp Extractor' : 'Email Extractor'}`
        }],
        sources: [{
          id: `src-tr-${Date.now()}-${addedCount}`,
          leadId,
          fieldName: email ? 'email' : 'phone',
          fieldValue: email || phoneToUse,
          sourceUrl: `Module ${sourceModule}`,
          sourceType: sourceModule === 'whatsapp' ? 'whatsapp_import' : 'email_import',
          foundAt: now
        }],
        importBatchId: batchId,
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now
      };

      await upsertLead(newLead);
      addedCount++;
    }

    res.json({
      success: true,
      addedCount
    });
  } catch (err: any) {
    console.error('[API] Error transferring contacts:', err);
    res.status(500).json({ error: 'Failed to transfer contacts', details: err.message });
  }
});

// 6. Trigger Single Lead Investigation / Enrich (Supports Force Re-investigation & Target Métier)
leadRouter.post(['/leads/:id/enrich', '/leads/search/:id'], async (req: Request, res: Response) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const forceReinvestigate = req.body?.forceReinvestigate ?? (req.query.force === 'true' || true);
    const targetMetier = req.body?.targetMetier || (req.query.metier as string) || (req.query.targetMetier as string);
    const enriched = await investigateAndEnrichLead(lead.rawPhone, lead, {
      forceReinvestigate,
      targetMetier
    });
    await upsertLead(enriched);

    res.json({
      success: true,
      lead: enriched
    });
  } catch (err: any) {
    console.error('[API] Error investigating lead:', err);
    res.status(500).json({ error: 'Investigation failed', details: err.message });
  }
});

// 7. Trigger Batch Investigation Queue with Scope / Re-analysis
leadRouter.post(['/leads/search', '/leads/reanalyze'], async (req: Request, res: Response) => {
  try {
    const { targetScope, leadIds, forceReinvestigate } = req.body || {};
    const jobState = await leadJobQueue.startQueue({
      targetScope: targetScope || 'all',
      leadIds,
      forceReinvestigate: forceReinvestigate !== false
    });
    res.json({
      success: true,
      job: jobState
    });
  } catch (err: any) {
    console.error('[API] Error starting investigation queue:', err);
    res.status(500).json({ error: 'Failed to start queue', details: err.message });
  }
});

// 8. Queue Management Endpoints
leadRouter.get(['/jobs', '/jobs/status'], (req: Request, res: Response) => {
  res.json(leadJobQueue.getStatus());
});

leadRouter.get('/jobs/:id', (req: Request, res: Response) => {
  res.json(leadJobQueue.getStatus());
});

leadRouter.post('/jobs/start', async (req: Request, res: Response) => {
  try {
    const { targetScope, leadIds, forceReinvestigate } = req.body || {};
    const status = await leadJobQueue.startQueue({
      targetScope,
      leadIds,
      forceReinvestigate
    });
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to start queue', details: err.message });
  }
});

leadRouter.post('/jobs/pause', async (req: Request, res: Response) => {
  const status = await leadJobQueue.pauseQueue();
  res.json(status);
});

leadRouter.post('/jobs/resume', async (req: Request, res: Response) => {
  const status = await leadJobQueue.resumeQueue();
  res.json(status);
});

leadRouter.post('/jobs/reset', async (req: Request, res: Response) => {
  const status = await leadJobQueue.resetQueue();
  res.json(status);
});

// 9. Search History & Audit Trail for a single lead
leadRouter.get('/search-history/:leadId', async (req: Request, res: Response) => {
  try {
    const lead = await getLeadById(req.params.leadId);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json({
      leadId: lead.id,
      phone: lead.normalizedPhone,
      searches: lead.searches,
      pendingQueries: lead.pendingQueries,
      searchLogs: lead.searchLogs,
      discoveries: lead.discoveries,
      candidateEmails: lead.candidateEmails
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get search history', details: err.message });
  }
});

// 10. Segments
leadRouter.get('/segments', async (req: Request, res: Response) => {
  try {
    const segments = await getSegments();
    res.json(segments);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get segments', details: err.message });
  }
});

leadRouter.post('/segments', async (req: Request, res: Response) => {
  try {
    const { code, label, keywords, keywordsFr, keywordsAr, color } = req.body;
    if (!code || !label) {
      res.status(400).json({ error: 'Code and label are required' });
      return;
    }

    await saveSegment({
      id: `seg-${Date.now()}`,
      code: code.toUpperCase().trim(),
      label: label.trim(),
      keywords: Array.isArray(keywords) ? keywords : [],
      keywordsFr: Array.isArray(keywordsFr) ? keywordsFr : [],
      keywordsAr: Array.isArray(keywordsAr) ? keywordsAr : [],
      isCustom: true,
      color: color || 'indigo'
    });

    const segments = await getSegments();
    res.json({ success: true, segments });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save segment', details: err.message });
  }
});

// 11. Lead Export
leadRouter.post('/leads/export', async (req: Request, res: Response) => {
  try {
    const options: LeadExportOptions = req.body;
    const filterOptions: LeadFilterOptions = {
      ...(options.filterOptions || {}),
      limit: 10000 // Export up to 10k items
    };

    if (options.type === 'email_only') {
      filterOptions.emailFilter = 'with_email';
    } else if (options.type === 'needs_verification') {
      filterOptions.status = 'NEEDS_VERIFICATION';
    } else if (options.type === 'without_email') {
      filterOptions.emailFilter = 'without_email';
    } else if (options.type === 'by_segment' && options.segmentCode) {
      filterOptions.sector = options.segmentCode;
    }

    const { leads } = await getLeads(filterOptions);

    // Export strictly ONLY phone numbers and person names as requested
    const headers = ['Nom', 'Téléphone'];
    const csvRows = [headers.map(h => `"${h}"`).join(',')];

    for (const l of leads) {
      const name = (l.fullName || '').replace(/"/g, '""');
      const phone = (l.nationalPhone || l.normalizedPhone || '').replace(/"/g, '""');
      csvRows.push(`"${name}","${phone}"`);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts_whatsapp_noms_telephones.csv"');
    res.send('\uFEFF' + csvRows.join('\r\n'));

  } catch (err: any) {
    console.error('[API] Export error:', err);
    res.status(500).json({ error: 'Failed to export leads', details: err.message });
  }
});

// 12. Delete single lead
leadRouter.delete('/leads/:id', async (req: Request, res: Response) => {
  try {
    await deleteLead(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete lead', details: err.message });
  }
});

// 13. Clear all leads or reset enrichment data
leadRouter.post('/leads/reset-enrichment', async (req: Request, res: Response) => {
  try {
    const { scope, leadIds } = req.body || {};
    const count = await resetLeadsForReanalysis(scope || 'all', leadIds);
    res.json({ success: true, resetCount: count });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to reset leads enrichment data', details: err.message });
  }
});

leadRouter.delete('/leads', async (req: Request, res: Response) => {
  try {
    await clearAllLeads();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to clear leads', details: err.message });
  }
});

leadRouter.post('/leads/clear-all', async (req: Request, res: Response) => {
  try {
    await clearAllLeads();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to clear leads', details: err.message });
  }
});
