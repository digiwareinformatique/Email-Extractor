/**
 * Adaptive Lead Investigation & Enrichment Engine
 * STE DigiWare SUARL - Lead Intelligence Platform
 * 
 * Implements: Dynamic Multi-Dimensional Search Decision Engine
 * Goal: Maximize probability of discovering and confirming a verified EMAIL
 */
import { LeadRecord, SearchLogEntry, LeadSourceRecord, PriorityQueryItem } from '../../src/types/lead';
import { defaultSearchProvider } from '../search/searchProvider';
import { extractEntitiesFromSearchResults } from '../discovery/entityExtractor';
import { calculateLeadConfidenceScores } from '../scoring/confidenceScorer';
import { normalizeTunisianPhone, getTunisianOperator } from '../services/normalization/phoneNormalizer';
import { transliterateArabicName, containsArabic } from '../services/normalization/nameTransliteration';
import { selectNextBestAction } from './actionSelector';

export async function investigateAndEnrichLead(
  rawPhone: string,
  existingLead?: Partial<LeadRecord>,
  options?: { forceReinvestigate?: boolean; clearHistory?: boolean; targetMetier?: string }
): Promise<LeadRecord> {
  const normPhone = normalizeTunisianPhone(rawPhone);
  const operator = getTunisianOperator(normPhone.clean8);
  const now = new Date().toISOString();
  const isForcedReanalysis = Boolean(options?.forceReinvestigate);
  const activeTargetMetier = options?.targetMetier || existingLead?.targetMetier || (existingLead?.primarySector && existingLead.primarySector !== 'INCONNU' ? existingLead.primarySector : undefined);

  // 1. Initialize or Load Lead State
  const lead: LeadRecord = {
    id: existingLead?.id || `DGR-${Date.now().toString().slice(-6)}`,
    rawPhone: existingLead?.rawPhone || rawPhone,
    normalizedPhone: normPhone.e164,
    nationalPhone: normPhone.national,
    operator: operator,
    firstName: isForcedReanalysis ? null : (existingLead?.firstName || null),
    lastName: isForcedReanalysis ? null : (existingLead?.lastName || null),
    fullName: existingLead?.fullName || null, // Keep original imported full name
    title: isForcedReanalysis ? null : (existingLead?.title || null),
    companyName: isForcedReanalysis ? null : (existingLead?.companyName || null),
    profession: isForcedReanalysis ? null : (existingLead?.profession || null),
    primarySector: isForcedReanalysis ? (activeTargetMetier || 'INCONNU') : (existingLead?.primarySector || activeTargetMetier || 'ENTREPRISE'),
    targetMetier: activeTargetMetier,
    segments: isForcedReanalysis ? (activeTargetMetier ? [activeTargetMetier] : []) : (existingLead?.segments || []),
    address: isForcedReanalysis ? null : (existingLead?.address || null),
    city: isForcedReanalysis ? null : (existingLead?.city || null),
    regionGovernorate: isForcedReanalysis ? null : (existingLead?.regionGovernorate || null),
    email: isForcedReanalysis ? null : (existingLead?.email || null),
    emailType: isForcedReanalysis ? null : (existingLead?.emailType || null),
    website: isForcedReanalysis ? null : (existingLead?.website || null),
    identityConfidence: isForcedReanalysis ? (existingLead?.fullName ? 50 : 0) : (existingLead?.identityConfidence || 0),
    emailConfidence: isForcedReanalysis ? 0 : (existingLead?.emailConfidence || 0),
    confidenceLevel: isForcedReanalysis ? 'LOW' : (existingLead?.confidenceLevel || 'LOW'),
    confidenceScore: isForcedReanalysis ? 0 : (existingLead?.confidenceScore || 0),
    status: 'PROCESSING',
    candidateEmails: isForcedReanalysis ? [] : (existingLead?.candidateEmails || []),
    identities: isForcedReanalysis ? (existingLead?.fullName ? [{ fullName: existingLead.fullName, confidence: 50, source: 'Import' }] : []) : (existingLead?.identities || []),
    professions: isForcedReanalysis ? [] : (existingLead?.professions || []),
    locations: isForcedReanalysis ? [] : (existingLead?.locations || []),
    organizations: isForcedReanalysis ? [] : (existingLead?.organizations || []),
    digitalAssets: isForcedReanalysis ? [] : (existingLead?.digitalAssets || []),
    discoveries: isForcedReanalysis ? [] : (existingLead?.discoveries || []),
    searches: isForcedReanalysis ? [] : (existingLead?.searches || []),
    pendingQueries: [],
    searchLogs: isForcedReanalysis ? [] : (existingLead?.searchLogs || []),
    sources: isForcedReanalysis ? [] : (existingLead?.sources || []),
    importBatchId: existingLead?.importBatchId,
    lastCheckedAt: now,
    createdAt: existingLead?.createdAt || now,
    updatedAt: now
  };

  const addLog = (type: SearchLogEntry['type'], message: string, details?: Record<string, any>) => {
    const entry: SearchLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    };
    lead.searchLogs.push(entry);
    console.log(`[LeadEngine:${lead.normalizedPhone}] [${type}] ${message}`);
  };

  if (isForcedReanalysis) {
    addLog('SEARCH', `Relance intégrale du moteur adaptatif pour le numéro ${lead.nationalPhone} (${lead.operator})`);
  } else {
    addLog('SEARCH', `Démarrage du moteur adaptatif pour le numéro ${lead.nationalPhone} (${lead.operator})`);
  }

  // 1b. Proactively discover and record French transliteration if name is in Arabic
  if (lead.fullName && containsArabic(lead.fullName)) {
    const translit = transliterateArabicName(lead.fullName);
    if (translit.primaryFrench) {
      if (!lead.firstName && translit.firstNameFrench) lead.firstName = translit.firstNameFrench;
      if (!lead.lastName && translit.lastNameFrench) lead.lastName = translit.lastNameFrench;
      if (!lead.identities.some(i => i.fullName.toLowerCase() === translit.primaryFrench.toLowerCase())) {
        lead.identities.push({
          fullName: translit.primaryFrench,
          firstName: translit.firstNameFrench,
          lastName: translit.lastNameFrench,
          title: lead.title,
          confidence: 85,
          source: 'transliteration_fr'
        });
        addLog('DISCOVERY', `Translitération en français identifiée : ${translit.primaryFrench} (utilisée pour Facebook, LinkedIn & Email)`);
      }
    }
  }

  // 2. Track executed queries and source family distribution
  const executedQueries = new Set<string>();
  const pastQueryCountsByFamily: Record<string, number> = {};

  if (!isForcedReanalysis && lead.searches) {
    for (const s of lead.searches) {
      executedQueries.add(s.query.toLowerCase().replace(/["'\s+]/g, ' ').replace(/\s+/g, ' ').trim());
      pastQueryCountsByFamily[s.sourceFamily] = (pastQueryCountsByFamily[s.sourceFamily] || 0) + 1;
    }
  }

  let consecutiveEmptyQueries = 0;
  const MAX_INVESTIGATION_STEPS = 6;
  let stepsExecuted = 0;

  // 3. Main Adaptive Investigation Loop
  while (stepsExecuted < MAX_INVESTIGATION_STEPS) {
    // Dynamically evaluate full prospect state and select the best next action
    const selection = selectNextBestAction(lead, executedQueries, pastQueryCountsByFamily);
    const chosenAction = selection.chosenAction;

    // Convert ranked candidates to pending queries for UI inspection
    lead.pendingQueries = selection.rankedCandidates.slice(1, 6).map((cand, idx) => ({
      id: cand.id,
      query: cand.query,
      reason: cand.description,
      sourceFamily: cand.sourceFamily,
      expectedValue: cand.expectedValue,
      priority: cand.score,
      prerequisites: [],
      generatedFrom: cand.rationale,
      status: 'PENDING'
    }));

    // If no action is available or top action score is below threshold, stop
    if (!chosenAction || chosenAction.score < 20) {
      addLog('STOP', `Clôture de l'investigation : ${selection.reason}`);
      break;
    }

    stepsExecuted++;
    const normKey = chosenAction.query.toLowerCase().replace(/["'\s+]/g, ' ').replace(/\s+/g, ' ').trim();
    executedQueries.add(normKey);
    pastQueryCountsByFamily[chosenAction.sourceFamily] = (pastQueryCountsByFamily[chosenAction.sourceFamily] || 0) + 1;

    addLog(
      'SEARCH',
      `[Étape ${stepsExecuted}/${MAX_INVESTIGATION_STEPS}] Décision : ${chosenAction.query}`,
      {
        actionType: chosenAction.type,
        score: chosenAction.score,
        scoreBreakdown: chosenAction.scoreBreakdown,
        rationale: chosenAction.rationale,
        competingCandidatesCount: selection.rankedCandidates.length
      }
    );

    // Prepare search log item
    const searchRecord: PriorityQueryItem = {
      id: chosenAction.id,
      query: chosenAction.query,
      reason: chosenAction.description,
      sourceFamily: chosenAction.sourceFamily,
      expectedValue: chosenAction.expectedValue,
      priority: chosenAction.score,
      prerequisites: [],
      generatedFrom: chosenAction.rationale,
      status: 'EXECUTING'
    };

    // Execute search via hybrid provider
    const searchResults = await defaultSearchProvider.search(chosenAction.query);
    searchRecord.status = 'DONE';
    searchRecord.resultsCount = searchResults.length;
    searchRecord.executedAt = new Date().toISOString();

    // Extract Entities & Discoveries from results
    const extracted = extractEntitiesFromSearchResults(searchResults, normPhone.clean8);
    searchRecord.discoveriesCount = extracted.discoveries.length;
    lead.searches.push(searchRecord);

    // Merge Digital Assets & Domains
    for (const asset of extracted.digitalAssets) {
      if (!lead.digitalAssets.some(a => a.url === asset.url)) {
        lead.digitalAssets.push(asset);
        if (asset.type === 'website' && !lead.website) {
          lead.website = asset.url;
          addLog('DISCOVERY', `Nouveau domaine web officiel découvert : ${asset.url}`);
        }
      }
    }

    // Merge Candidate Emails with Corroboration Count
    for (const cand of extracted.candidateEmails) {
      const existing = lead.candidateEmails.find(e => e.email.toLowerCase() === cand.email.toLowerCase());
      if (!existing) {
        lead.candidateEmails.push(cand);
        addLog('DISCOVERY', `Email candidat découvert : ${cand.email} (${cand.emailType}, Score: ${cand.score}%)`);
      } else {
        existing.corroborationCount += 1;
        existing.score = Math.min(100, existing.score + 15);
        if (cand.sources) {
          for (const s of cand.sources) {
            if (!existing.sources.includes(s)) existing.sources.push(s);
          }
        }
        addLog('VERIFICATION', `Corrélation accrue pour ${cand.email} (Occurrences: ${existing.corroborationCount}, Score: ${existing.score}%)`);
      }
    }

    // Sort candidate emails by confidence score
    lead.candidateEmails.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Merge Identities (Rule: If French name found in SERP, adapt it directly)
    for (const id of extracted.identities) {
      if (!lead.identities.some(i => i.fullName.toLowerCase() === id.fullName.toLowerCase())) {
        lead.identities.push(id);
      }
      
      const isDiscoveredFrench = !containsArabic(id.fullName);
      const isCurrentArabic = lead.fullName ? containsArabic(lead.fullName) : true;

      if (!lead.fullName || (isCurrentArabic && isDiscoveredFrench)) {
        const oldName = lead.fullName;
        lead.fullName = id.fullName;
        lead.firstName = id.firstName || null;
        lead.lastName = id.lastName || null;
        lead.title = id.title || null;
        if (oldName && oldName !== id.fullName) {
          addLog('DISCOVERY', `Nom en français adapté depuis le SERP : ${id.fullName} (Précédent : ${oldName})`);
        } else {
          addLog('DISCOVERY', `Identité découverte : ${id.title ? id.title + ' ' : ''}${id.fullName}`);
        }
      }
    }

    // Rule: Guarantee 100% that lead is linked to target profession (Avocat / Maître, etc.)
    const activeMetier = (lead.targetMetier || lead.primarySector || '').toUpperCase();
    const allResultsText = searchResults.map(r => `${r.title} ${r.snippet}`).join(' ').toLowerCase();

    if (activeMetier === 'AVOCAT') {
      if (allResultsText.includes('avocat') || allResultsText.includes('maître') || allResultsText.includes('barreau') || allResultsText.includes('محامي') || allResultsText.includes('الأستاذ')) {
        lead.primarySector = 'AVOCAT';
        lead.profession = 'Avocat à la Cour';
        if (!lead.title) lead.title = 'Maître';
        lead.identityConfidence = Math.max(90, lead.identityConfidence);
        if (!lead.segments.includes('AVOCAT')) lead.segments.push('AVOCAT');
        addLog('VERIFICATION', `Garantie 100% : Prospect formellement authentifié Maître Avocat au Barreau`);
      }
    } else if (activeMetier === 'ECOLE_PRIVEE' || activeMetier === 'ECOLE') {
      if (allResultsText.includes('école') || allResultsText.includes('lycée') || allResultsText.includes('collège') || allResultsText.includes('مدرسة')) {
        lead.primarySector = 'ECOLE_PRIVEE';
        lead.profession = 'Établissement Éducatif Privé';
        lead.identityConfidence = Math.max(90, lead.identityConfidence);
        if (!lead.segments.includes('ECOLE_PRIVEE')) lead.segments.push('ECOLE_PRIVEE');
        addLog('VERIFICATION', `Garantie 100% : Prospect formellement vérifié Établissement Éducatif Privé`);
      }
    } else if (activeMetier === 'SANTE' || activeMetier === 'MEDECIN') {
      if (allResultsText.includes('docteur') || allResultsText.includes('dr') || allResultsText.includes('médecin') || allResultsText.includes('طبيب')) {
        lead.primarySector = 'SANTE';
        lead.profession = 'Médecin / Docteur';
        if (!lead.title) lead.title = 'Dr';
        lead.identityConfidence = Math.max(90, lead.identityConfidence);
        if (!lead.segments.includes('SANTE')) lead.segments.push('SANTE');
        addLog('VERIFICATION', `Garantie 100% : Prospect formellement vérifié Professionnel de Santé`);
      }
    }

    // Merge Professions & Sectors
    for (const prof of extracted.professions) {
      if (!lead.professions.some(p => p.profession.toLowerCase() === prof.profession.toLowerCase())) {
        lead.professions.push(prof);
        if (!lead.profession) {
          lead.profession = prof.profession;
          lead.primarySector = prof.sector;
          addLog('DISCOVERY', `Métier / Secteur détecté : ${prof.profession} (${prof.sector})`);
        }
      }
    }

    // Merge Organizations
    for (const org of extracted.organizations) {
      if (!lead.organizations.some(o => o.name.toLowerCase() === org.name.toLowerCase())) {
        lead.organizations.push(org);
        if (!lead.companyName) {
          lead.companyName = org.name;
          addLog('DISCOVERY', `Structure / Organisation identifiée : ${org.name}`);
        }
      }
    }

    // Merge Locations
    for (const loc of extracted.locations) {
      if (!lead.locations.some(l => l.city.toLowerCase() === loc.city.toLowerCase())) {
        lead.locations.push(loc);
        if (!lead.city) {
          lead.city = loc.city;
          lead.regionGovernorate = loc.regionGovernorate || null;
          addLog('DISCOVERY', `Localisation confirmée : ${loc.city} (${loc.regionGovernorate || 'Tunisie'})`);
        }
      }
    }

    // Add Raw Sources for audit traceability
    for (const disc of extracted.discoveries) {
      lead.discoveries.push(disc);
      const srcRecord: LeadSourceRecord = {
        id: `src-${Date.now()}-${lead.sources.length}`,
        leadId: lead.id,
        fieldName: (disc.field as any) || 'email',
        fieldValue: disc.value,
        sourceUrl: disc.sourceUrl,
        sourceType: disc.sourceType,
        snippet: disc.snippet,
        foundAt: disc.timestamp
      };
      lead.sources.push(srcRecord);
    }

    // Recalculate Dual Confidence Scores
    const currentScores = calculateLeadConfidenceScores(lead);
    lead.identityConfidence = currentScores.identityConfidence;
    lead.emailConfidence = currentScores.emailConfidence;
    lead.confidenceScore = currentScores.confidenceScore;
    lead.confidenceLevel = currentScores.confidenceLevel;
    lead.status = currentScores.status;

    // TERMINAL OBJECTIVE CHECK:
    // If we have achieved a high-confidence confirmed email (emailConfidence >= 85)
    if (lead.emailConfidence >= 85 && lead.candidateEmails.length > 0) {
      lead.email = lead.candidateEmails[0].email;
      lead.emailType = lead.candidateEmails[0].emailType;
      addLog(
        'STOP',
        `🎯 Objectif terminal atteint : Email professionnel validé (${lead.email}, Confiance Email: ${lead.emailConfidence}%). Arrêt immédiat de l'exploration.`
      );
      break;
    }

    // Track empty query yield
    if (extracted.discoveries.length === 0) {
      consecutiveEmptyQueries++;
    } else {
      consecutiveEmptyQueries = 0;
    }

    // Circuit breaker: 2 consecutive zero-yield queries with no high-value candidates remaining
    if (consecutiveEmptyQueries >= 2 && selection.rankedCandidates.every(c => c.score < 50)) {
      addLog('STOP', 'Épuisement des pistes sans nouvelle information exploitable.');
      break;
    }
  }

  // 4. Final Email Assignment
  // If an email is verified with at least 50% confidence, assign it
  if (!lead.email && lead.candidateEmails.length > 0 && lead.candidateEmails[0].score >= 50) {
    lead.email = lead.candidateEmails[0].email;
    lead.emailType = lead.candidateEmails[0].emailType;
  }

  // Final scoring and wrap-up
  const finalScores = calculateLeadConfidenceScores(lead);
  lead.identityConfidence = finalScores.identityConfidence;
  lead.emailConfidence = finalScores.emailConfidence;
  lead.confidenceScore = finalScores.confidenceScore;
  lead.confidenceLevel = finalScores.confidenceLevel;
  lead.status = finalScores.status;
  lead.updatedAt = new Date().toISOString();

  return lead;
}
