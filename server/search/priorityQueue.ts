/**
 * Dynamic Priority Query Generator & Investigation Queue
 * STE DigiWare SUARL - Lead Intelligence Architecture
 * 
 * Philosophy: NOUVELLE INFORMATION = NOUVELLE CLÉ DE RECHERCHE
 */
import { PriorityQueryItem, LeadRecord } from '../../src/types/lead';
import { getSourcePackForSector } from '../sources/sourcePacks';

export class InvestigationPriorityQueue {
  private queue: PriorityQueryItem[] = [];
  private executedHashes: Set<string> = new Set();

  constructor(initialQueries: PriorityQueryItem[] = []) {
    for (const q of initialQueries) {
      this.push(q);
    }
  }

  private normalizeQueryKey(query: string): string {
    return query.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  public push(item: PriorityQueryItem): boolean {
    const key = this.normalizeQueryKey(item.query);
    if (this.executedHashes.has(key)) {
      return false;
    }
    // Check if already in queue
    const exists = this.queue.some(q => this.normalizeQueryKey(q.query) === key);
    if (exists) {
      return false;
    }

    this.queue.push(item);
    // Sort descending by priority
    this.queue.sort((a, b) => b.priority - a.priority);
    return true;
  }

  public pop(): PriorityQueryItem | undefined {
    const item = this.queue.shift();
    if (item) {
      this.executedHashes.add(this.normalizeQueryKey(item.query));
      item.status = 'EXECUTING';
    }
    return item;
  }

  public peek(): PriorityQueryItem | undefined {
    return this.queue[0];
  }

  public size(): number {
    return this.queue.length;
  }

  public getPending(): PriorityQueryItem[] {
    return [...this.queue];
  }

  public markExecuted(query: string): void {
    this.executedHashes.add(this.normalizeQueryKey(query));
  }

  public clearExecuted(): void {
    this.executedHashes.clear();
  }

  public clearQueue(): void {
    this.queue = [];
  }

  public reset(initialQueries: PriorityQueryItem[] = []): void {
    this.queue = [];
    this.executedHashes.clear();
    for (const q of initialQueries) {
      this.push(q);
    }
  }

  /**
   * Generates adaptive next queries dynamically based on current lead evidence
   */
  public generateNextQueries(lead: LeadRecord): PriorityQueryItem[] {
    const newQueries: PriorityQueryItem[] = [];
    const context: Record<string, string> = {
      phone: lead.rawPhone,
      clean8: lead.normalizedPhone.replace(/\+216/, ''),
      national: lead.nationalPhone,
      name: lead.fullName || (lead.firstName ? `${lead.firstName} ${lead.lastName || ''}`.trim() : ''),
      title: lead.title || '',
      profession: lead.profession || '',
      sector: lead.primarySector || 'ENTREPRISE',
      company: lead.companyName || '',
      city: lead.city || 'Tunisie',
      domain: lead.website ? lead.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : ''
    };

    const hasIdentity = !!context.name;
    const hasProfession = !!context.profession;
    const hasCompany = !!context.company;
    const hasDomain = !!context.domain;
    const hasEmail = lead.candidateEmails.length > 0;

    // 1. If Candidate Email found -> Generate Confirmation Query (Highest Priority)
    if (hasEmail) {
      const topEmail = lead.candidateEmails[0].email;
      const queryText = `"${topEmail}"`;
      newQueries.push({
        id: `q-conf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: queryText,
        reason: `Vérification d'empreinte et de légitimité pour l'email découvert ${topEmail}`,
        sourceFamily: 'CONFIRMATION',
        expectedValue: 'VERY_HIGH',
        priority: 100,
        prerequisites: ['candidate_email'],
        generatedFrom: `Email candidat: ${topEmail}`,
        status: 'PENDING'
      });
    }

    // 2. If Domain found -> Generate Domain Audit Queries
    if (hasDomain) {
      const domainQuery = `site:${context.domain} (contact OR email OR "@" OR direction)`;
      newQueries.push({
        id: `q-dom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: domainQuery,
        reason: `Audit du nom de domaine officiel ${context.domain} pour extraire les adresses de contact`,
        sourceFamily: 'DOMAIN_AUDIT',
        expectedValue: 'VERY_HIGH',
        priority: 95,
        prerequisites: ['domain'],
        generatedFrom: `Nom de domaine: ${context.domain}`,
        status: 'PENDING'
      });
    }

    // 3. If Company / Cabinet found -> Search Company Email & Facebook
    if (hasCompany) {
      const compFbQuery = `site:facebook.com "${context.company}" ${context.city || 'Tunisie'}`;
      newQueries.push({
        id: `q-compfb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: compFbQuery,
        reason: `Recherche de la page Facebook officielle de ${context.company}`,
        sourceFamily: 'FACEBOOK',
        expectedValue: 'VERY_HIGH',
        priority: 90,
        prerequisites: ['companyName'],
        generatedFrom: `Entreprise/Cabinet: ${context.company}`,
        status: 'PENDING'
      });

      const compEmailQuery = `"${context.company}" ${context.city || 'Tunisie'} (email OR contact OR "@")`;
      newQueries.push({
        id: `q-compem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: compEmailQuery,
        reason: `Recherche d'adresses email associées à ${context.company}`,
        sourceFamily: 'EMAIL_SEARCH',
        expectedValue: 'HIGH',
        priority: 88,
        prerequisites: ['companyName'],
        generatedFrom: `Entreprise: ${context.company}`,
        status: 'PENDING'
      });
    }

    // 4. If Identity + Profession established -> Generate Facebook, LinkedIn & Sector Pack queries
    if (hasIdentity) {
      const fbQuery = `site:facebook.com "${context.name}" ${context.profession || context.city || 'Tunisie'}`;
      newQueries.push({
        id: `q-fb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: fbQuery,
        reason: `Recherche du profil / page professionnelle Facebook de ${context.name}`,
        sourceFamily: 'FACEBOOK',
        expectedValue: 'VERY_HIGH',
        priority: 85,
        prerequisites: ['fullName'],
        generatedFrom: `Identité: ${context.name}`,
        status: 'PENDING'
      });

      const liQuery = `site:tn.linkedin.com/in/ "${context.name}"`;
      newQueries.push({
        id: `q-li-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: liQuery,
        reason: `Recherche du profil LinkedIn de ${context.name}`,
        sourceFamily: 'LINKEDIN',
        expectedValue: 'HIGH',
        priority: 80,
        prerequisites: ['fullName'],
        generatedFrom: `Identité: ${context.name}`,
        status: 'PENDING'
      });

      // Apply Sector Source Pack Templates
      const pack = getSourcePackForSector(lead.primarySector || 'ENTREPRISE');
      for (const tpl of pack.queryTemplates) {
        try {
          const generatedQuery = tpl.template(context);
          newQueries.push({
            id: `q-pack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            query: generatedQuery,
            reason: tpl.reason,
            sourceFamily: tpl.family,
            expectedValue: tpl.expectedValue,
            priority: tpl.priorityWeight,
            prerequisites: ['sector'],
            generatedFrom: `Source Pack: ${pack.label}`,
            status: 'PENDING'
          });
        } catch (e) {
          // ignore template formatting errors
        }
      }
    }

    // Push all valid new queries into queue
    for (const q of newQueries) {
      this.push(q);
    }

    return newQueries;
  }
}
