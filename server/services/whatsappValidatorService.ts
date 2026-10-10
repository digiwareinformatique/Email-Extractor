/**
 * WhatsApp Number Verification & Validation Service
 * Architecture Métier Robuste & Réutilisable
 * 
 * Interroge le moteur WhatsAppSenderEngine (session WhatsApp Web réelle / Baileys / getNumberId)
 * Normalise les numéros tunisiens et internationaux
 * Cache configurable (whatsappVerificationFreshnessDays)
 * Throttle & concurrence configurables pour protéger la session
 * Persiste les statuts réels dans SQLite (crm_contacts)
 */

import { 
  getCrmContactById, 
  updateContactWhatsAppStatus, 
  addBusinessActivityLog,
  getCrmListById,
  getCrmContacts
} from '../database/businessCenterDb';
import { getSenderSession } from '../database/senderDb';
import { whatsappSenderEngine } from '../sender/whatsappSenderEngine';
import { normalizeTunisianPhone } from './normalization/phoneNormalizer';
import { WhatsAppValidationProgress, WhatsAppValidationStatus } from '../../src/types/businessCenter';

export interface ValidationSingleResult {
  contactId: string;
  phone: string;
  normalizedPhone: string;
  status: WhatsAppValidationStatus;
  jid?: string;
  error?: string;
  checkedAt: string;
  fromCache?: boolean;
}

export interface ValidationOptions {
  forceRecheck?: boolean;
  freshnessDays?: number;
  concurrency?: number;
  delayMs?: number;
}

class WhatsAppValidatorService {
  private static instance: WhatsAppValidatorService;
  private activeJobs = new Map<string, WhatsAppValidationProgress>();
  
  // Paramètres par défaut configurables
  public defaultFreshnessDays = 30; // whatsappVerificationFreshnessDays
  public defaultConcurrency = 2;   // Protège la session WhatsApp
  public defaultDelayBetweenChecksMs = 200; // Pause de sécurité entre chaque vérification

  private constructor() {}

  public static getInstance(): WhatsAppValidatorService {
    if (!WhatsAppValidatorService.instance) {
      WhatsAppValidatorService.instance = new WhatsAppValidatorService();
    }
    return WhatsAppValidatorService.instance;
  }

  /**
   * Vérifie si un statut mis en cache est encore valide (frais)
   */
  private isCacheFresh(checkedAt?: string, freshnessDays: number = this.defaultFreshnessDays): boolean {
    if (!checkedAt) return false;
    const checkDate = new Date(checkedAt).getTime();
    if (isNaN(checkDate)) return false;
    const now = Date.now();
    const maxAgeMs = freshnessDays * 24 * 60 * 60 * 1000;
    return (now - checkDate) < maxAgeMs;
  }

  /**
   * Validation unitaire d'un contact CRM
   */
  public async validateSingleContact(
    contactId: string, 
    options?: ValidationOptions
  ): Promise<ValidationSingleResult> {
    const contact = await getCrmContactById(contactId);
    if (!contact) {
      throw new Error(`Contact introuvable avec l'ID: ${contactId}`);
    }

    const now = new Date().toISOString();
    const freshnessDays = options?.freshnessDays ?? this.defaultFreshnessDays;

    // 1. Vérification du cache : si déjà vérifié récemment et pas de revérification forcée
    const currentStatus = contact.whatsapp_status;
    const isAlreadyChecked = currentStatus && currentStatus !== 'NOT_CHECKED' && currentStatus !== 'CHECKING' && currentStatus !== 'UNKNOWN';
    
    if (!options?.forceRecheck && isAlreadyChecked && this.isCacheFresh(contact.whatsapp_checked_at, freshnessDays)) {
      // Normaliser 'NOT_ON_WHATSAPP' vers 'NOT_EXISTS'
      const normalizedStatus: WhatsAppValidationStatus = currentStatus === 'NOT_ON_WHATSAPP' ? 'NOT_EXISTS' : currentStatus;
      return {
        contactId: contact.id,
        phone: contact.phone,
        normalizedPhone: contact.normalized_phone,
        status: normalizedStatus,
        jid: contact.whatsapp_jid,
        error: contact.whatsapp_check_error,
        checkedAt: contact.whatsapp_checked_at || now,
        fromCache: true
      };
    }

    // 2. Normalisation du numéro
    const norm = normalizeTunisianPhone(contact.phone);
    if (!norm.isValid) {
      const resultStatus: WhatsAppValidationStatus = 'INVALID_FORMAT';
      const errorMsg = 'Format de numéro invalide (doit contenir un indicatif international valide ou 8 chiffres)';
      await updateContactWhatsAppStatus(contact.id, resultStatus, undefined, errorMsg);
      return {
        contactId: contact.id,
        phone: contact.phone,
        normalizedPhone: contact.phone,
        status: resultStatus,
        error: errorMsg,
        checkedAt: now,
        fromCache: false
      };
    }

    const cleanInternational = norm.e164.replace('+', '');

    // 3. Vérification de la session WhatsApp
    const session = await getSenderSession();
    if (session.status !== 'CONNECTED') {
      const errorMsg = "WhatsApp Sender non connecté. Veuillez scanner le QR Code ou reconnecter la session.";
      // RÈGLE CRITIQUE : Une déconnexion NE DOIT JAMAIS devenir NOT_EXISTS
      await updateContactWhatsAppStatus(contact.id, 'ERROR', undefined, errorMsg);
      return {
        contactId: contact.id,
        phone: contact.phone,
        normalizedPhone: cleanInternational,
        status: 'ERROR',
        error: errorMsg,
        checkedAt: now,
        fromCache: false
      };
    }

    // 4. Interrogation de la session WhatsApp réelle
    let checkResult: { exists: boolean; jid?: string; error?: string; isTemporaryError?: boolean };
    try {
      checkResult = await whatsappSenderEngine.checkNumberRegistered(cleanInternational);
      
      // Retry unique après pause en cas d'erreur transitoire réseau
      if (checkResult.isTemporaryError && checkResult.error) {
        await new Promise(r => setTimeout(r, 500));
        checkResult = await whatsappSenderEngine.checkNumberRegistered(cleanInternational);
      }
    } catch (engineErr: any) {
      checkResult = {
        exists: false,
        error: engineErr.message || 'Erreur interne de communication avec WhatsApp',
        isTemporaryError: true
      };
    }

    let finalStatus: WhatsAppValidationStatus = 'UNKNOWN';
    let jid: string | undefined = undefined;
    let error: string | undefined = undefined;

    if (checkResult.exists) {
      finalStatus = 'EXISTS';
      jid = checkResult.jid;
    } else if (checkResult.error) {
      // Erreur réseau ou session : NE PAS marquer comme NOT_EXISTS
      finalStatus = checkResult.isTemporaryError ? 'UNKNOWN' : 'ERROR';
      error = checkResult.error;
    } else {
      // WhatsApp confirme que le compte n'existe pas
      finalStatus = 'NOT_EXISTS';
    }

    // 5. Persistance en base SQLite
    await updateContactWhatsAppStatus(contact.id, finalStatus, jid, error);

    return {
      contactId: contact.id,
      phone: contact.phone,
      normalizedPhone: cleanInternational,
      status: finalStatus,
      jid,
      error,
      checkedAt: now,
      fromCache: false
    };
  }

  /**
   * Lancement d'un job de vérification par lot
   */
  public async startBatchValidation(
    contactIds: string[], 
    options?: ValidationOptions
  ): Promise<WhatsAppValidationProgress> {
    const uniqueIds = Array.from(new Set(contactIds.filter(Boolean)));
    const jobId = `val_job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const progress: WhatsAppValidationProgress = {
      jobId,
      total: uniqueIds.length,
      processed: 0,
      existsCount: 0,
      notExistsCount: 0,
      notOnWaCount: 0,
      unknownCount: 0,
      invalidCount: 0,
      errorCount: 0,
      status: 'RUNNING',
      startedAt: now,
      results: []
    };

    this.activeJobs.set(jobId, progress);

    await addBusinessActivityLog({
      event_type: 'CRM_UPDATED',
      title: `Vérification WhatsApp initiée pour ${uniqueIds.length} contact(s)`,
      details: { jobId, total: uniqueIds.length, forceRecheck: options?.forceRecheck }
    });

    // Traitement asynchrone en arrière-plan sans bloquer
    this.processBatchQueue(jobId, uniqueIds, options).catch(err => {
      console.error(`[WhatsAppValidator] Erreur dans le batch ${jobId}:`, err);
      const current = this.activeJobs.get(jobId);
      if (current) {
        current.status = 'FAILED';
        current.errorMessage = err.message || 'Erreur inattendue durant la vérification';
      }
    });

    return progress;
  }

  /**
   * Vérification de tous les contacts d'une liste CRM
   */
  public async validateList(
    listId: string,
    options?: ValidationOptions
  ): Promise<WhatsAppValidationProgress> {
    const list = await getCrmListById(listId);
    if (!list) {
      throw new Error(`Liste CRM introuvable avec l'ID: ${listId}`);
    }

    if (list.contact_ids.length === 0) {
      throw new Error(`La liste "${list.name}" ne contient aucun contact à vérifier.`);
    }

    return this.startBatchValidation(list.contact_ids, options);
  }

  /**
   * File d'attente avec concurrence contrôlée et throttle
   */
  private async processBatchQueue(
    jobId: string, 
    contactIds: string[], 
    options?: ValidationOptions
  ): Promise<void> {
    const concurrency = Math.min(Math.max(options?.concurrency || this.defaultConcurrency, 1), 5);
    const delayMs = Math.max(options?.delayMs || this.defaultDelayBetweenChecksMs, 50);
    const queue = [...contactIds];

    const worker = async () => {
      while (queue.length > 0) {
        const currentJob = this.activeJobs.get(jobId);
        if (!currentJob || (currentJob.status as string) === 'CANCELLED') {
          break;
        }

        const contactId = queue.shift();
        if (!contactId) continue;

        try {
          const res = await this.validateSingleContact(contactId, options);
          const liveJob = this.activeJobs.get(jobId);
          
          if (liveJob && (liveJob.status as string) !== 'CANCELLED') {
            liveJob.processed++;
            if (res.status === 'EXISTS') {
              liveJob.existsCount++;
            } else if (res.status === 'NOT_EXISTS' || res.status === 'NOT_ON_WHATSAPP') {
              liveJob.notExistsCount++;
              liveJob.notOnWaCount = liveJob.notExistsCount;
            } else if (res.status === 'UNKNOWN') {
              liveJob.unknownCount++;
            } else if (res.status === 'INVALID_FORMAT') {
              liveJob.invalidCount++;
            } else if (res.status === 'ERROR') {
              liveJob.errorCount++;
            }

            liveJob.results.push({
              contactId: res.contactId,
              phone: res.phone,
              status: res.status,
              jid: res.jid,
              error: res.error
            });
          }
        } catch (err: any) {
          const liveJob = this.activeJobs.get(jobId);
          if (liveJob && (liveJob.status as string) !== 'CANCELLED') {
            liveJob.processed++;
            liveJob.errorCount++;
            liveJob.results.push({
              contactId,
              phone: 'Inconnu',
              status: 'ERROR',
              error: err.message || 'Erreur inattendue'
            });
          }
        }

        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    };

    // Lancement des workers concurrents
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    const finalJob = this.activeJobs.get(jobId);
    if (finalJob && finalJob.status === 'RUNNING') {
      finalJob.status = 'COMPLETED';
      finalJob.completedAt = new Date().toISOString();

      await addBusinessActivityLog({
        event_type: 'CRM_UPDATED',
        title: `Vérification WhatsApp terminée (${finalJob.existsCount} EXISTS, ${finalJob.notExistsCount} NOT_EXISTS, ${finalJob.unknownCount} UNKNOWN, ${finalJob.errorCount + finalJob.invalidCount} ERREURS)`,
        details: {
          jobId,
          total: finalJob.total,
          exists: finalJob.existsCount,
          notExists: finalJob.notExistsCount,
          unknown: finalJob.unknownCount,
          errors: finalJob.errorCount,
          invalid: finalJob.invalidCount
        }
      });
    }
  }

  /**
   * Consultation du statut d'un job de vérification
   */
  public getValidationJob(jobId: string): WhatsAppValidationProgress | null {
    return this.activeJobs.get(jobId) || null;
  }

  /**
   * Annulation d'un job actif
   */
  public cancelValidationJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (job && (job.status === 'RUNNING' || job.status === 'QUEUED')) {
      job.status = 'CANCELLED';
      job.completedAt = new Date().toISOString();
      return true;
    }
    return false;
  }
}

export const whatsappValidatorService = WhatsAppValidatorService.getInstance();
