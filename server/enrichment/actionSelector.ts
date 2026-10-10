/**
 * Adaptive Action Selector & Multi-Dimensional Investigation Strategist
 * STE DigiWare SUARL - Lead Intelligence Platform
 * 
 * Philosophy:
 * - NO hardcoded rigid chains (hasDomain -> domain, else org -> org).
 * - Full prospect state evaluation at EVERY step.
 * - Generates ALL candidate actions, scores each across 4 dimensions:
 *     1. Terminal Impact (direct progress toward verified email)
 *     2. Information Specificity (precision & lack of ambiguity)
 *     3. State Utility (necessity given what is known vs missing)
 *     4. Diminishing Returns Penalty (anti-redundancy & failure fatigue)
 * - Selects the action that dynamically maximizes probability of getting or confirming an email.
 */
import { LeadRecord, PriorityQueryItem } from '../../src/types/lead';
import { getSourcePackForSector, getMetierKeywords } from '../sources/sourcePacks';
import { transliterateArabicName, containsArabic } from '../services/normalization/nameTransliteration';

export interface InvestigationCandidateAction {
  id: string;
  type: 
    | 'PHONE_ANCHOR' 
    | 'IDENTITY_EXPANSION' 
    | 'ORGANIZATION_DISCOVERY' 
    | 'DOMAIN_AUDIT' 
    | 'ORGANIZATION_EMAIL_SEARCH'
    | 'EMAIL_CANDIDATE_VERIFICATION' 
    | 'CROSS_CORROBORATION'
    | 'SOCIAL_PROFILE_SEARCH'
    | 'SECTOR_REGISTRY_SEARCH';
  query: string;
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
  description: string;
  rationale: string;
  expectedValue: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  scoreBreakdown: {
    terminalImpact: number;             // 0-100: directness towards finding/confirming email
    informationSpecificity: number;     // 0-100: precision and discrimination of query terms
    stateUtility: number;               // 0-100: how crucial is this missing piece right now
    diminishingReturnsPenalty: number;  // 0-50: penalty for redundancy or repeated failure
  };
}

export interface SelectionResult {
  chosenAction: InvestigationCandidateAction | null;
  rankedCandidates: InvestigationCandidateAction[];
  reason: string;
}

/**
 * Normalizes query string for deduplication comparison
 */
function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/["'\s+]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Generates all relevant candidate actions for the current prospect state
 */
export function generateCandidateActions(
  lead: LeadRecord,
  executedQueries: Set<string>
): InvestigationCandidateAction[] {
  const candidates: InvestigationCandidateAction[] = [];
  const clean8 = lead.normalizedPhone.replace(/\+216/, '');
  const nationalPhone = lead.nationalPhone || clean8;
  const fullName = lead.fullName?.trim() || '';
  const firstName = lead.firstName?.trim() || '';
  const lastName = lead.lastName?.trim() || '';
  const profession = lead.profession?.trim() || '';
  const companyName = lead.companyName?.trim() || '';
  const city = lead.city?.trim() || '';
  const sector = lead.primarySector || 'ENTREPRISE';
  const metierInfo = getMetierKeywords(lead.targetMetier || sector);

  // Compute French / Latin transliteration of Arabic names
  const isArabicName = containsArabic(fullName);
  const translit = transliterateArabicName(fullName);
  const frenchFullName = translit.primaryFrench || fullName;
  const frenchFirstName = translit.firstNameFrench || firstName;
  const frenchLastName = translit.lastNameFrench || lastName;

  // Extract primary website domain if available
  let domain = '';
  if (lead.website) {
    try {
      const url = lead.website.startsWith('http') ? lead.website : `https://${lead.website}`;
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      domain = lead.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
  }

  // Fallback domain from digital assets
  if (!domain && lead.digitalAssets) {
    const webAsset = lead.digitalAssets.find(a => a.type === 'website');
    if (webAsset && webAsset.url) {
      try {
        const u = webAsset.url.startsWith('http') ? webAsset.url : `https://${webAsset.url}`;
        domain = new URL(u).hostname.replace(/^www\./, '');
      } catch {
        domain = webAsset.url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      }
    }
  }

  const hasIdentity = fullName.length > 2;
  const hasProfession = profession.length > 2;
  const hasCompany = companyName.length > 2;
  const hasDomain = domain.length > 3;
  const hasCandidateEmails = lead.candidateEmails.length > 0;
  const topCandidate = hasCandidateEmails ? lead.candidateEmails[0] : null;

  // PRIORITY: If Facebook Page was directly found during phone search or in discoveries, inspect for email
  const fbAsset = lead.digitalAssets?.find(a => a.type === 'facebook') || lead.discoveries?.find(d => d.field === 'facebook');
  if (fbAsset && !lead.email) {
    candidates.push({
      id: `act-fb-inspect-${Date.now()}`,
      type: 'EMAIL_CANDIDATE_VERIFICATION',
      query: `site:facebook.com "${frenchFullName || fullName}" (contact OR email OR "@")`,
      sourceFamily: 'FACEBOOK',
      description: `Extraction prioritaire de l'e-mail sur la page Facebook officielle`,
      rationale: `La page Facebook officielle est identifiée. Priorité absolue utilisateur : extraire l'adresse e-mail de contact direct.`,
      expectedValue: 'VERY_HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 98,
        informationSpecificity: 98,
        stateUtility: 98,
        diminishingReturnsPenalty: 0
      }
    });
  }

  // -------------------------------------------------------------
  // FAMILY 1: EMAIL CANDIDATE VERIFICATION & CORROBORATION
  // -------------------------------------------------------------
  if (hasCandidateEmails && topCandidate) {
    const email = topCandidate.email;
    const emailDomain = email.split('@')[1] || '';

    // A. Direct Email Proof Search
    candidates.push({
      id: `act-email-exact-${Date.now()}`,
      type: 'EMAIL_CANDIDATE_VERIFICATION',
      query: `"${email}"`,
      sourceFamily: 'CONFIRMATION',
      description: `Vérification d'empreinte publique pour l'email candidat ${email}`,
      rationale: `Vérifie si cet email candidat précis apparaît publiquement dans des répertoires, publications ou mentions légales officielles`,
      expectedValue: 'VERY_HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 96,
        informationSpecificity: 100,
        stateUtility: topCandidate.score < 85 ? 95 : 40,
        diminishingReturnsPenalty: 0
      }
    });

    // B. Cross-Corroboration: Email + Original Phone
    candidates.push({
      id: `act-corrob-phone-${Date.now()}`,
      type: 'CROSS_CORROBORATION',
      query: `"${email}" ("${clean8}" OR "${nationalPhone}")`,
      sourceFamily: 'CONFIRMATION',
      description: `Corrélation directe : Email ${email} + Téléphone ${nationalPhone}`,
      rationale: `Prouve formellement le lien direct et irréfutable entre le numéro de téléphone source et l'adresse email candidate`,
      expectedValue: 'VERY_HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 98,
        informationSpecificity: 100,
        stateUtility: topCandidate.corroborationCount < 2 ? 98 : 35,
        diminishingReturnsPenalty: 0
      }
    });

    // C. Cross-Corroboration: Email + Full Name
    if (hasIdentity) {
      candidates.push({
        id: `act-corrob-name-${Date.now()}`,
        type: 'CROSS_CORROBORATION',
        query: `"${email}" "${fullName}"`,
        sourceFamily: 'CONFIRMATION',
        description: `Corrélation d'identité : Email ${email} + ${fullName}`,
        rationale: `Atteste que l'adresse email appartient nominativement à la personne identifiée`,
        expectedValue: 'HIGH',
        score: 0,
        scoreBreakdown: {
          terminalImpact: 90,
          informationSpecificity: 95,
          stateUtility: topCandidate.score < 85 ? 90 : 30,
          diminishingReturnsPenalty: 0
        }
      });
    }

    // D. Email Domain Proof if domain is known
    if (emailDomain && !['gmail.com', 'yahoo.fr', 'yahoo.com', 'hotmail.com', 'outlook.com', 'topnet.tn'].includes(emailDomain)) {
      candidates.push({
        id: `act-email-domain-${Date.now()}`,
        type: 'DOMAIN_AUDIT',
        query: `site:${emailDomain} ("${email}" OR contact OR direction)`,
        sourceFamily: 'DOMAIN_AUDIT',
        description: `Audit du serveur hôte ${emailDomain} pour certifier ${email}`,
        rationale: `Confirme que l'adresse email fait partie intégrante du nom de domaine institutionnel ou d'entreprise`,
        expectedValue: 'HIGH',
        score: 0,
        scoreBreakdown: {
          terminalImpact: 92,
          informationSpecificity: 95,
          stateUtility: topCandidate.score < 85 ? 88 : 25,
          diminishingReturnsPenalty: 0
        }
      });
    }
  }

  // -------------------------------------------------------------
  // FAMILY 2: DOMAIN AUDIT (WEBSITE DISCOVERED)
  // -------------------------------------------------------------
  if (hasDomain) {
    // A. Contact / Email target on domain
    candidates.push({
      id: `act-dom-contact-${Date.now()}`,
      type: 'DOMAIN_AUDIT',
      query: `site:${domain} (contact OR email OR "@" OR coordonnées)`,
      sourceFamily: 'DOMAIN_AUDIT',
      description: `Extraction des emails et pages de contact sur ${domain}`,
      rationale: `Interroge directement l'arborescence du domaine officiel pour extraire l'adresse de contact principale`,
      expectedValue: 'HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: hasCandidateEmails ? 65 : 88,
        informationSpecificity: 92,
        stateUtility: hasCandidateEmails ? 50 : 92,
        diminishingReturnsPenalty: 0
      }
    });

    // B. Nominal or Direction target on domain if identity known
    if (hasIdentity || hasProfession) {
      const targetToken = lastName || fullName.split(' ').pop() || profession || 'direction';
      candidates.push({
        id: `act-dom-nominal-${Date.now()}`,
        type: 'DOMAIN_AUDIT',
        query: `site:${domain} ("${targetToken}" OR direction OR gerant)`,
        sourceFamily: 'DOMAIN_AUDIT',
        description: `Recherche nominative/direction sur ${domain} (${targetToken})`,
        rationale: `Isole les adresses nominatives des dirigeants ou associés sur le site officiel`,
        expectedValue: 'HIGH',
        score: 0,
        scoreBreakdown: {
          terminalImpact: hasCandidateEmails ? 60 : 82,
          informationSpecificity: 90,
          stateUtility: hasCandidateEmails ? 45 : 85,
          diminishingReturnsPenalty: 0
        }
      });
    }
  }

  // -------------------------------------------------------------
  // FAMILY 3: ORGANIZATION / CABINET ACTIONS
  // -------------------------------------------------------------
  if (hasCompany) {
    // A. Direct Company Email query
    candidates.push({
      id: `act-org-email-${Date.now()}`,
      type: 'ORGANIZATION_EMAIL_SEARCH',
      query: `"${companyName}" (email OR contact OR "@") ${city || 'Tunisie'}`,
      sourceFamily: 'EMAIL_SEARCH',
      description: `Recherche d'adresses email associées à ${companyName}`,
      rationale: `Cible les mentions publiques d'emails rattachées directement à la dénomination de l'entreprise/cabinet`,
      expectedValue: 'HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: hasCandidateEmails ? 55 : 82,
        informationSpecificity: 82,
        stateUtility: hasDomain ? (hasCandidateEmails ? 35 : 65) : 88,
        diminishingReturnsPenalty: 0
      }
    });

    // B. Organization Facebook Page (to extract domain and email)
    candidates.push({
      id: `act-org-fb-${Date.now()}`,
      type: 'ORGANIZATION_DISCOVERY',
      query: `site:facebook.com "${companyName}" ${city || 'Tunisie'}`,
      sourceFamily: 'FACEBOOK',
      description: `Recherche de la page Facebook officielle de ${companyName}`,
      rationale: `En Tunisie, les pages Facebook professionnelles contiennent presque toujours le site web, l'email ou le mobile officiel`,
      expectedValue: 'HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 82,
        informationSpecificity: 90,
        stateUtility: hasDomain ? 45 : 88,
        diminishingReturnsPenalty: 0
      }
    });

    // C. Organization Instagram Page
    candidates.push({
      id: `act-org-ig-${Date.now()}`,
      type: 'ORGANIZATION_DISCOVERY',
      query: `site:instagram.com "${companyName}" Tunisie`,
      sourceFamily: 'INSTAGRAM',
      description: `Compte Instagram officiel d'entreprise pour ${companyName}`,
      rationale: `Recherche de la vitrine Instagram pour identifier les liens bio (Linktree, site ou email direct)`,
      expectedValue: 'MEDIUM',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 65,
        informationSpecificity: 85,
        stateUtility: hasDomain ? 35 : 78,
        diminishingReturnsPenalty: 0
      }
    });
  }

  // -------------------------------------------------------------
  // FAMILY 4: IDENTITY & PROFESSIONAL CONTEXT (FACEBOOK, LINKEDIN, INSTAGRAM, REGISTRIES)
  // -------------------------------------------------------------
  if (hasIdentity) {
    const metierWordFr = metierInfo.primaryFr;
    const metierWordAr = metierInfo.primaryAr;

    // A1. PRIORITY 1: Facebook Professional Search with French Name + Métier Keyword
    candidates.push({
      id: `act-id-fb-fr-${Date.now()}`,
      type: 'SOCIAL_PROFILE_SEARCH',
      query: `site:facebook.com "${frenchFullName}" ${metierWordFr}`,
      sourceFamily: 'FACEBOOK',
      description: `Recherche Facebook prioritaire en français pour ${frenchFullName} (${metierWordFr})`,
      rationale: `En Tunisie, Facebook est le réseau n°1 des professionnels et commerces. Presque tous y indiquent leur email de contact ou mobile officiel.`,
      expectedValue: 'VERY_HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 90,
        informationSpecificity: 95,
        stateUtility: 96,
        diminishingReturnsPenalty: 0
      }
    });

    // A2. Facebook Search with Arabic Name (if lead name is in Arabic)
    if (isArabicName && fullName !== frenchFullName) {
      candidates.push({
        id: `act-id-fb-ar-${Date.now()}`,
        type: 'SOCIAL_PROFILE_SEARCH',
        query: `site:facebook.com "${fullName}" ${metierWordAr}`,
        sourceFamily: 'FACEBOOK',
        description: `Page Facebook professionnelle en arabe pour ${fullName} (${metierWordAr})`,
        rationale: `Recherche complémentaire sur Facebook sous la graphie arabe originale pour intercepter les pages locales`,
        expectedValue: 'HIGH',
        score: 0,
        scoreBreakdown: {
          terminalImpact: 84,
          informationSpecificity: 90,
          stateUtility: 90,
          diminishingReturnsPenalty: 0
        }
      });
    }

    // B. LinkedIn Pro Search in Latin / French (spécifiquement croisé avec Facebook)
    candidates.push({
      id: `act-id-li-${Date.now()}`,
      type: 'SOCIAL_PROFILE_SEARCH',
      query: `site:tn.linkedin.com/in/ "${frenchFullName}" ${metierWordFr}`,
      sourceFamily: 'LINKEDIN',
      description: `Profil LinkedIn Tunisie de ${frenchFullName} (${metierWordFr})`,
      rationale: `En Tunisie, les profils LinkedIn sont rédigés en français. Indispensable pour corroborer avec Facebook, valider le métier et identifier le domaine web officiel.`,
      expectedValue: 'HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 80,
        informationSpecificity: 92,
        stateUtility: 88,
        diminishingReturnsPenalty: 0
      }
    });

    // C. Direct Email & Contact Web Search with French Name + Métier
    candidates.push({
      id: `act-id-email-fr-${Date.now()}`,
      type: 'ORGANIZATION_EMAIL_SEARCH',
      query: `"${frenchFullName}" ${metierWordFr} (contact OR email OR "@")`,
      sourceFamily: 'EMAIL_SEARCH',
      description: `Recherche d'email direct sur le binôme [${frenchFullName} + ${metierWordFr}]`,
      rationale: `Recherche directe d'adresses email citées dans des annuaires d'ordres, répertoires ou publications professionnelles en français`,
      expectedValue: 'HIGH',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 86,
        informationSpecificity: 90,
        stateUtility: 92,
        diminishingReturnsPenalty: 0
      }
    });

    // C2. Direct Email Search in Arabic if name is Arabic
    if (isArabicName) {
      candidates.push({
        id: `act-id-email-ar-${Date.now()}`,
        type: 'ORGANIZATION_EMAIL_SEARCH',
        query: `"${fullName}" ${metierWordAr} (contact OR email OR "@")`,
        sourceFamily: 'EMAIL_SEARCH',
        description: `Recherche d'email direct en arabe pour [${fullName} + ${metierWordAr}]`,
        rationale: `Recherche directe d'empreinte email sous la graphie arabe originale avec le métier ciblé`,
        expectedValue: 'HIGH',
        score: 0,
        scoreBreakdown: {
          terminalImpact: 84,
          informationSpecificity: 88,
          stateUtility: 90,
          diminishingReturnsPenalty: 0
        }
      });
    }

    // D. Instagram Pro Search
    candidates.push({
      id: `act-id-ig-${Date.now()}`,
      type: 'SOCIAL_PROFILE_SEARCH',
      query: `site:instagram.com "${frenchFullName}"`,
      sourceFamily: 'INSTAGRAM',
      description: `Profil Instagram officiel Tunisie de ${frenchFullName}`,
      rationale: `Recherche du compte Instagram professionnel afin d'extraire les coordonnées de bio (Linktree, site ou email direct)`,
      expectedValue: 'MEDIUM',
      score: 0,
      scoreBreakdown: {
        terminalImpact: 68,
        informationSpecificity: 82,
        stateUtility: 75,
        diminishingReturnsPenalty: 0
      }
    });

    // E. French Name + Phone Direct Corroboration
    if (!hasDomain) {
      candidates.push({
        id: `act-id-phone-corrob-${Date.now()}`,
        type: 'CROSS_CORROBORATION',
        query: `"${frenchFullName}" "${clean8}"`,
        sourceFamily: 'IDENTITY_SEARCH',
        description: `Corrélation directe Nom Français + Téléphone`,
        rationale: `Vérifie la liaison entre le nom translitéré et le numéro pour confirmer l'empreinte numérique`,
        expectedValue: 'HIGH',
        score: 0,
        scoreBreakdown: {
          terminalImpact: 70,
          informationSpecificity: 92,
          stateUtility: 80,
          diminishingReturnsPenalty: 0
        }
      });
    }

    // F. Sector Registry Pack Queries (Lawyers, Doctors, Accountants, etc.)
    const pack = getSourcePackForSector(sector);
    const contextMap: Record<string, string> = {
      fullName: frenchFullName || fullName,
      firstName: frenchFirstName || firstName,
      lastName: frenchLastName || lastName,
      profession: profession || pack.label,
      city: city || 'Tunis',
      phone: nationalPhone,
      clean8,
      national: nationalPhone,
      company: companyName,
      domain
    };

    for (const tpl of pack.queryTemplates) {
      try {
        const queryStr = tpl.template(contextMap);
        // Skip queries that contain literal undefined or require missing fields
        if (queryStr.includes('undefined') || queryStr.includes('""')) {
          continue;
        }
        candidates.push({
          id: `act-pack-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          type: 'SECTOR_REGISTRY_SEARCH',
          query: queryStr,
          sourceFamily: 'IDENTITY_SEARCH',
          description: tpl.reason,
          rationale: `Interrogation du registre sectoriel spécialisé (${pack.label})`,
          expectedValue: tpl.expectedValue as 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW',
          score: 0,
          scoreBreakdown: {
            terminalImpact: 65,
            informationSpecificity: 78,
            stateUtility: hasCompany && hasDomain ? 35 : 75,
            diminishingReturnsPenalty: 0
          }
        });
      } catch {
        // ignore templating errors
      }
    }
  }

  // -------------------------------------------------------------
  // FAMILY 5: INITIAL PHONE ANCHOR (START OR RESCUE)
  // -------------------------------------------------------------
  // Clean phone search is only high priority when no identity or company is yet known!
  candidates.push({
    id: `act-phone-initial-${Date.now()}`,
    type: 'PHONE_ANCHOR',
    query: `"${clean8}" OR "${nationalPhone}"`,
    sourceFamily: 'PHONE_LOOKUP',
    description: `Recherche d'ancrage télécom pour ${nationalPhone}`,
    rationale: `Recherche minimale non-biaisée sur l'annuaire national et le web public`,
    expectedValue: hasIdentity ? 'LOW' : 'VERY_HIGH',
    score: 0,
    scoreBreakdown: {
      terminalImpact: hasIdentity ? 15 : 75,
      informationSpecificity: 70,
      stateUtility: hasIdentity ? 10 : 98,
      diminishingReturnsPenalty: hasIdentity ? 35 : 0
    }
  });

  return candidates;
}

/**
 * Multi-dimensional scoring & ranking engine for candidate investigation actions
 */
export function scoreCandidateActions(
  candidates: InvestigationCandidateAction[],
  lead: LeadRecord,
  executedQueries: Set<string>,
  pastQueryCountsByFamily: Record<string, number> = {}
): InvestigationCandidateAction[] {
  const scored: InvestigationCandidateAction[] = [];

  for (const action of candidates) {
    const normKey = normalizeQuery(action.query);
    
    // If exact query was already executed, skip it completely
    if (executedQueries.has(normKey)) {
      continue;
    }

    // RULE 1: Phone Anchor in SERP is ALWAYS Step 1!
    if (action.type === 'PHONE_ANCHOR' && (pastQueryCountsByFamily['PHONE_LOOKUP'] || 0) === 0) {
      action.score = 100;
      scored.push(action);
      continue;
    }

    const { terminalImpact, informationSpecificity, stateUtility } = action.scoreBreakdown;
    let diminishingPenalty = action.scoreBreakdown.diminishingReturnsPenalty || 0;

    // Fatigue penalty if a source family (e.g. FACEBOOK, LINKEDIN) has already been searched multiple times without yielding an email
    const familySearches = pastQueryCountsByFamily[action.sourceFamily] || 0;
    if (familySearches >= 2) {
      diminishingPenalty += 20;
    } else if (familySearches === 1) {
      diminishingPenalty += 8;
    }

    // Dynamic boost / penalty based on prospect state:
    // If an email candidate is present and its score is still low, VERIFICATION actions get a major relative boost
    let contextualBoost = 0;
    if (lead.candidateEmails.length > 0) {
      const topEmail = lead.candidateEmails[0];
      if (topEmail.score < 85) {
        if (action.type === 'EMAIL_CANDIDATE_VERIFICATION' || action.type === 'CROSS_CORROBORATION') {
          contextualBoost += 15;
        }
      }
    }

    // RULE 2: If Facebook page was identified in phone SERP, priority is checking the Facebook page for the email!
    const hasFacebookPage = lead.digitalAssets?.some(a => a.type === 'facebook') || lead.discoveries?.some(d => d.field === 'facebook');
    if (hasFacebookPage && !lead.email && lead.candidateEmails.filter(e => e.score >= 85).length === 0) {
      if (action.id.startsWith('act-fb-inspect') || (action.sourceFamily === 'FACEBOOK' && action.type === 'EMAIL_CANDIDATE_VERIFICATION')) {
        contextualBoost += 30;
      }
    }

    // RULE 3: In Tunisia, Facebook is the primary commercial channel: boost Facebook on first identity exploration
    const hasIdentityOrOrg = Boolean((lead.fullName && lead.fullName.length > 2) || (lead.companyName && lead.companyName.length > 2));
    if (hasIdentityOrOrg && action.sourceFamily === 'FACEBOOK' && familySearches === 0) {
      contextualBoost += 22;
    }

    // If an identity is already strongly confirmed (confidence >= 80%), penalize further generic identity lookups
    if (lead.identityConfidence >= 80) {
      if (action.type === 'IDENTITY_EXPANSION' || action.type === 'PHONE_ANCHOR') {
        diminishingPenalty += 30;
      }
    }

    // Formula: (TerminalImpact * 0.40) + (Specificity * 0.25) + (StateUtility * 0.35) + Boost - Penalty
    const compositeScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (terminalImpact * 0.40) +
          (informationSpecificity * 0.25) +
          (stateUtility * 0.35) +
          contextualBoost -
          diminishingPenalty
        )
      )
    );

    action.score = compositeScore;
    action.scoreBreakdown.diminishingReturnsPenalty = diminishingPenalty;
    scored.push(action);
  }

  // Sort descending by calculated score
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Main Entry Point: Selects the single best next action based on the complete prospect state
 */
export function selectNextBestAction(
  lead: LeadRecord,
  executedQueries: Set<string>,
  pastQueryCountsByFamily: Record<string, number> = {}
): SelectionResult {
  // 1. Generate all feasible candidate actions
  const allCandidates = generateCandidateActions(lead, executedQueries);

  // 2. Score each candidate across multi-dimensional criteria
  const ranked = scoreCandidateActions(allCandidates, lead, executedQueries, pastQueryCountsByFamily);

  if (ranked.length === 0) {
    return {
      chosenAction: null,
      rankedCandidates: [],
      reason: 'Toutes les pistes d\'investigation ont été épuisées.'
    };
  }

  const best = ranked[0];
  const reason = `Action sélectionnée : [${best.type}] "${best.query}" (Score: ${best.score}/100) — Impact terminal: ${best.scoreBreakdown.terminalImpact}, Spécificité: ${best.scoreBreakdown.informationSpecificity}, Utilité d'état: ${best.scoreBreakdown.stateUtility}. ${best.rationale}`;

  return {
    chosenAction: best,
    rankedCandidates: ranked,
    reason
  };
}
