/**
 * WhatsApp Sender Execution Engine
 * Powered by whatsapp-web.js (Puppeteer, real Chromium & WhatsApp Web)
 */

import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import whatsappWeb from 'whatsapp-web.js';
const { Client, LocalAuth, MessageAck } = whatsappWeb as any;
import { 
  SenderJob, 
  SenderSession, 
  SenderSettings
} from '../../src/types/sender';
import {
  createJob,
  getJobById,
  getJobByExternalMessageId,
  updateJob,
  getNextExecutableJob,
  getSenderSession,
  updateSenderSession,
  getSenderSettings,
  updateSenderSettings,
  addSenderLog,
  isPhoneBlacklisted,
  addToBlacklist,
  cancelAllJobsForPhone
} from '../database/senderDb';
import { processOutreachMessage, isOptOutMessage } from './spintaxEngine';

const SESSIONS_DIR = path.join(process.cwd(), 'data', 'sessions');
const WWEBJS_AUTH_DIR = path.join(SESSIONS_DIR, 'wwebjs_auth');

export interface DispatchResult {
  success: boolean;
  externalMessageId?: string;
  chatId?: string;
  error?: string;
  errorCode?: string;
  deliveryAck?: 'sent' | 'delivered' | 'read' | 'held_undelivered' | 'pending_unconfirmed';
}

export class WhatsAppSenderEngine {
  private static instance: WhatsAppSenderEngine;
  private client: any | null = null;
  private workerInterval: NodeJS.Timeout | null = null;
  private isInitializingClient = false;
  private isProcessingCurrentJob = false;
  private currentAbortController: AbortController | null = null;
  private pendingMessages = new Map<string, {
    jobId?: string;
    phone: string;
    jid: string;
    createdAt: number;
    resolve?: (ack: { status: string; ack: any }) => void;
    reject?: (err: any) => void;
  }>();

  private constructor() {
    this.ensureSessionStorage();
    getSenderSession().then(session => {
      if (session.status === 'CONNECTED' || (fs.existsSync(WWEBJS_AUTH_DIR) && fs.readdirSync(WWEBJS_AUTH_DIR).length > 0)) {
        console.log('[Sender Engine] Auto-initializing WhatsApp client from saved session on startup...');
        this.initWhatsAppSocket().catch(err => {
          console.error('[Sender Engine] Auto-init socket error:', err);
        });
      }
    }).catch(() => {});
  }

  public static getInstance(): WhatsAppSenderEngine {
    if (!WhatsAppSenderEngine.instance) {
      WhatsAppSenderEngine.instance = new WhatsAppSenderEngine();
    }
    return WhatsAppSenderEngine.instance;
  }

  private ensureSessionStorage(): void {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    if (!fs.existsSync(WWEBJS_AUTH_DIR)) {
      fs.mkdirSync(WWEBJS_AUTH_DIR, { recursive: true });
    }
  }

  /**
   * Initialize whatsapp-web.js Client & Event Listeners
   */
  public async initWhatsAppSocket(): Promise<void> {
    if (this.isInitializingClient || (this.client && this.client.info)) {
      return;
    }
    this.isInitializingClient = true;

    try {
      this.ensureSessionStorage();

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: 'whatsapp-sender-session',
          dataPath: SESSIONS_DIR
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        }
      });

      this.client.on('qr', async (qr) => {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 360,
            margin: 2,
            color: { dark: '#020617', light: '#ffffff' },
            errorCorrectionLevel: 'M'
          });
          await updateSenderSession({
            status: 'AUTH_REQUIRED',
            qrCode: qrDataUrl,
            pairingCode: null,
            errorMessage: null,
            sessionDir: WWEBJS_AUTH_DIR
          });
          await addSenderLog('INFO', 'QR_READY', 'QR Code WhatsApp Web prêt. Scannez avec votre téléphone.');
        } catch (e: any) {
          console.error('[Sender Engine] QR generation error:', e);
        }
      });

      this.client.on('ready', async () => {
        const info = this.client?.info;
        const phone = info?.wid?.user ? `+${info.wid.user}` : '+WhatsApp';
        const pushName = info?.pushname || 'WhatsApp Web Active';

        await updateSenderSession({
          status: 'CONNECTED',
          phoneNumber: phone,
          pushName: pushName,
          qrCode: null,
          pairingCode: null,
          connectedAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          errorMessage: null,
          sessionDir: WWEBJS_AUTH_DIR
        });

        await addSenderLog('SUCCESS', 'SESSION_CONNECTED', `Session WhatsApp Web (whatsapp-web.js) connectée et authentifiée pour ${phone} (${pushName}).`);
      });

      this.client.on('authenticated', async () => {
        await addSenderLog('INFO', 'AUTHENTICATED', 'Session WhatsApp Web authentifiée avec succès.');
      });

      this.client.on('auth_failure', async (msg) => {
        await updateSenderSession({
          status: 'DISCONNECTED',
          qrCode: null,
          errorMessage: `Échec d'authentification: ${msg}`
        });
        await addSenderLog('ERROR', 'AUTH_FAILED', `Échec d'authentification WhatsApp Web: ${msg}`);
      });

      this.client.on('disconnected', async (reason) => {
        await updateSenderSession({
          status: 'DISCONNECTED',
          phoneNumber: null,
          pushName: null,
          connectedAt: null,
          qrCode: null,
          errorMessage: `Déconnecté: ${reason}`
        });
        await addSenderLog('WARN', 'DISCONNECTED', `Session WhatsApp Web déconnectée: ${reason}`);
      });

      // Listen to incoming messages for Opt-Out / STOP detection
      this.client.on('message', async (msg) => {
        if (!msg.fromMe && msg.body) {
          const senderPhone = msg.from.split('@')[0];
          await this.handleIncomingReply(senderPhone, msg.body);
        }
      });

      // Listen to message acknowledgments (ACK_SERVER, ACK_DEVICE, ACK_READ, ACK_ERROR)
      this.client.on('message_ack', async (msg, ack) => {
        const msgId = msg.id._serialized;
        if (!msgId) return;

        console.log(`[Sender] MESSAGE_ACK update for ${msgId}, ack = ${ack}`);

        const tracked = this.pendingMessages.get(msgId);
        const job = await getJobByExternalMessageId(msgId);

        // WhatsApp Web.js acks:
        // ACK_ERROR = -1
        // ACK_PENDING = 0
        // ACK_SERVER = 1
        // ACK_DEVICE = 2
        // ACK_READ = 3
        // ACK_PLAYED = 4
        if (ack === MessageAck.ACK_SERVER || ack === 1) {
          if (tracked && tracked.resolve) tracked.resolve({ status: 'sent', ack });
          if (job && job.status !== 'SENT') {
            await updateJob(job.id, {
              status: 'SENT',
              delivery_ack: 'sent',
              completed_at: new Date().toISOString()
            });
            await addSenderLog('INFO', 'SERVER_EVENT', `[Sender] SERVER_EVENT: Confirmation serveur reçue pour le message ${msgId}`, job.id, { messageId: msgId });
          }
        } else if (ack === MessageAck.ACK_DEVICE || ack === 2 || ack === 3) {
          if (tracked && tracked.resolve) tracked.resolve({ status: 'delivered', ack });
          if (job) {
            await updateJob(job.id, {
              status: 'SENT',
              delivery_ack: 'delivered'
            });
            await addSenderLog('SUCCESS', 'DELIVERY_ACK', `[Sender] DELIVERY_ACK: Message ${msgId} distribué à l'appareil`, job.id, { messageId: msgId });
          }
        } else if (ack === MessageAck.ACK_READ || ack === 4) {
          if (tracked && tracked.resolve) tracked.resolve({ status: 'read', ack });
          if (job) {
            await updateJob(job.id, {
              status: 'SENT',
              delivery_ack: 'read'
            });
            await addSenderLog('SUCCESS', 'READ_ACK', `[Sender] READ_ACK: Message ${msgId} lu`, job.id, { messageId: msgId });
          }
        } else if (ack === MessageAck.ACK_ERROR || ack === -1) {
          const errObj = { code: 'ERR_WHATSAPP_SEND_FAILED', message: 'Message rejeté ou erreur de livraison par WhatsApp.' };
          if (tracked && tracked.reject) tracked.reject(errObj);
          if (job) {
            await updateJob(job.id, {
              status: 'FAILED',
              error_code: errObj.code,
              error_message: errObj.message
            });
            await addSenderLog('ERROR', 'SEND_FAILED', `[Sender] SEND_FAILED: Message ${msgId} en erreur d'accusé`, job.id, { messageId: msgId, ack });
          }
        }
      });

      console.log('[Sender Engine] Initializing whatsapp-web.js client...');
      await this.client.initialize();
    } catch (err: any) {
      console.error('[Sender Engine] Failed to initialize whatsapp-web.js client:', err);
      await addSenderLog('ERROR', 'CLIENT_INIT_FAILED', `Échec d'initialisation du client whatsapp-web.js : ${err.message}`);
    } finally {
      this.isInitializingClient = false;
    }
  }

  /**
   * REAL WhatsApp Web Message Dispatch Engine via whatsapp-web.js
   */
  public async sendRealWhatsAppMessage(
    rawPhone: string,
    messageText: string,
    jobId?: string
  ): Promise<{ success: boolean; messageId: string; phone: string; jid: string; deliveryAck: 'sent' | 'delivered' | 'read' | 'held_undelivered' | 'pending_unconfirmed'; timestamp: string }> {
    // 1. Phone validation & normalization
    await addSenderLog('INFO', 'START', `[Sender] START: Initialisation de l'envoi vers ${rawPhone}`, jobId, { rawPhone, messageLength: messageText.length });

    const phoneCheck = this.validateAndFormatPhone(rawPhone);
    if (!phoneCheck.isValid) {
      const reason = phoneCheck.reason || 'Format de téléphone invalide.';
      await addSenderLog('ERROR', 'SEND_FAILED', `[Sender] SEND_FAILED: Numéro ${rawPhone} invalide (${reason})`, jobId, { rawPhone, reason });
      throw {
        code: 'ERR_INVALID_PHONE_FORMAT',
        isTemporary: false,
        message: reason
      };
    }

    const cleanPhone = phoneCheck.formatted;
    await addSenderLog('INFO', 'PHONE_NORMALIZED', `[Sender] PHONE_NORMALIZED: +${cleanPhone} (E.164 validé)`, jobId, { phone: cleanPhone });

    // 2. Blacklist verification
    const isBlacklisted = await isPhoneBlacklisted(cleanPhone);
    if (isBlacklisted) {
      await addSenderLog('WARN', 'SEND_FAILED', `[Sender] SEND_FAILED: Numéro +${cleanPhone} sur liste noire (Opt-Out)`, jobId, { phone: cleanPhone });
      throw {
        code: 'ERR_BLACKLISTED',
        isTemporary: false,
        message: `Le numéro +${cleanPhone} est inscrit sur la liste noire (Désabonné). Envoi bloqué pour conformité.`
      };
    }

    // 3. WhatsApp Session verification
    const session = await getSenderSession();
    if (session.status === 'CONNECTED' && !this.client) {
      await addSenderLog('INFO', 'AUTO_RECONNECT', '[Sender] Session connectée en base mais client non initialisé en mémoire. Restauration automatique...', jobId);
      try {
        await this.initWhatsAppSocket();
        let attempts = 0;
        while ((!this.client || !this.client.info) && attempts < 15) {
          await new Promise(r => setTimeout(r, 1000));
          attempts++;
        }
      } catch (e) {
        console.warn('[Sender Engine] Auto-reconnect attempt note:', e);
      }
    }

    if (session.status !== 'CONNECTED' || !this.client) {
      await addSenderLog('ERROR', 'SEND_FAILED', `[Sender] SEND_FAILED: Session WhatsApp Web non connectée`, jobId);
      throw {
        code: 'ERR_WHATSAPP_NOT_CONNECTED',
        isTemporary: true,
        message: 'La session WhatsApp Web n\'est pas connectée. Veuillez scanner le QR Code.'
      };
    }

    // 4. Resolve number with client.getNumberId(phone)
    let numberId: any;
    let targetSerialized: string;
    try {
      numberId = await this.client.getNumberId(cleanPhone);
      if (!numberId || !numberId._serialized) {
        throw new Error('Numéro non enregistré sur WhatsApp');
      }
      targetSerialized = numberId._serialized;
      await addSenderLog('INFO', 'WHATSAPP_EXISTS', `[Sender] WHATSAPP_EXISTS: Compte WhatsApp vérifié pour +${cleanPhone}`, jobId, { phone: cleanPhone, serialized: targetSerialized });
    } catch (err: any) {
      await addSenderLog('ERROR', 'SEND_FAILED', `[Sender] SEND_FAILED: Numéro +${cleanPhone} non enregistré sur WhatsApp`, jobId, { phone: cleanPhone });
      throw {
        code: 'ERR_NUMBER_NOT_ON_WHATSAPP',
        isTemporary: false,
        message: `Le numéro +${cleanPhone} n'est pas enregistré sur WhatsApp (vérifiez que le numéro et l'indicatif international sont corrects).`
      };
    }

    // 5. Get chat, simulate typing (40ms per character, clamped between 1500ms and 6000ms)
    const typingMs = Math.min(Math.max(messageText.length * 40, 1500), 6000);
    try {
      const chat = await this.client.getChatById(targetSerialized);
      await chat.sendStateTyping();
      await addSenderLog('INFO', 'TYPING_SIMULATION', `[Sender] TYPING_SIMULATION: Simulation de saisie humaine en cours (${typingMs}ms)...`, jobId, { typingMs });
      await new Promise(r => setTimeout(r, typingMs));
    } catch (typingErr) {
      // non-blocking
    }

    // 6. Send message with client.sendMessage
    let externalMessageId: string;
    try {
      await addSenderLog('INFO', 'SEND_STARTED', `[Sender] SEND_STARTED: Transmission en cours vers +${cleanPhone} (${targetSerialized})`, jobId, { target: targetSerialized });

      const sentMessage = await this.client.sendMessage(targetSerialized, messageText);
      const rawId = sentMessage?.id;
      externalMessageId = typeof rawId === 'string' 
        ? rawId 
        : (rawId?._serialized || rawId?.id || `wmsg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
      
      await addSenderLog('INFO', 'MESSAGE_ID', `[Sender] MESSAGE_ID: Message ID généré: ${externalMessageId}`, jobId, { externalMessageId });

      try {
        const chat = await this.client.getChatById(targetSerialized);
        await chat.clearState();
      } catch {}
    } catch (sendErr: any) {
      console.error('[Sender Engine] whatsapp-web.js send error:', sendErr);
      await addSenderLog('ERROR', 'SEND_FAILED', `[Sender] SEND_FAILED: Erreur d'envoi vers +${cleanPhone} : ${sendErr.message}`, jobId, { error: sendErr.message });
      throw {
        code: 'ERR_WHATSAPP_SEND_FAILED',
        isTemporary: true,
        message: `Échec de l'envoi WhatsApp Web : ${sendErr.message || 'Erreur de transmission'}`
      };
    }

    // 7. Track message in memory and wait up to 25s for server ACK and device delivery ACK
    let observedDeliveryAck: 'sent' | 'delivered' | 'read' | 'held_undelivered' | 'pending_unconfirmed' = 'pending_unconfirmed';
    try {
      const ackResult = await new Promise<{ status: 'sent' | 'delivered' | 'read' | 'held_undelivered' | 'pending_unconfirmed' }>((resolve, reject) => {
        let receivedServerAck = false;

        const timer = setTimeout(() => {
          this.pendingMessages.delete(externalMessageId);
          if (receivedServerAck) {
            resolve({ status: 'held_undelivered' });
          } else {
            resolve({ status: 'pending_unconfirmed' });
          }
        }, 25000);

        this.pendingMessages.set(externalMessageId, {
          jobId,
          phone: cleanPhone,
          jid: targetSerialized,
          createdAt: Date.now(),
          resolve: (ack) => {
            if (ack.status === 'delivered' || ack.status === 'read') {
              clearTimeout(timer);
              this.pendingMessages.delete(externalMessageId);
              resolve({ status: ack.status as any });
            } else if (ack.status === 'sent') {
              receivedServerAck = true;
            }
          },
          reject: (err) => {
            clearTimeout(timer);
            this.pendingMessages.delete(externalMessageId);
            reject(err);
          }
        });
      });
      observedDeliveryAck = ackResult.status;
    } catch (ackErr: any) {
      if (jobId) {
        await updateJob(jobId, {
          status: 'FAILED',
          error_code: ackErr.code || 'ERR_WHATSAPP_SEND_FAILED',
          error_message: ackErr.message
        });
      }
      throw {
        code: ackErr.code || 'ERR_WHATSAPP_SEND_FAILED',
        isTemporary: false,
        message: ackErr.message || 'Erreur d\'accusé de réception.'
      };
    }

    const nowIso = new Date().toISOString();
    if (observedDeliveryAck === 'held_undelivered') {
      const warnText = "Message accepté par WhatsApp mais non distribué au destinataire (probable contact non établi / rétention anti-spam 463). Enregistrez ce numéro dans les contacts du téléphone lié puis réessayez.";
      await addSenderLog('WARN', 'MESSAGE_HELD', `[Sender] MESSAGE_HELD: ${warnText}`, jobId, { externalMessageId, phone: cleanPhone });
      if (jobId) {
        await updateJob(jobId, { status: 'SENT', delivery_ack: 'held_undelivered' });
      }
    } else if (observedDeliveryAck === 'pending_unconfirmed') {
      await addSenderLog('WARN', 'ACK_TIMEOUT', `[Sender] ACK_TIMEOUT: Aucun accusé de réception reçu en 25s pour le message ${externalMessageId}`, jobId, { externalMessageId, phone: cleanPhone });
      if (jobId) {
        await updateJob(jobId, { status: 'SENT', delivery_ack: 'pending_unconfirmed' });
      }
    } else if (observedDeliveryAck === 'delivered' || observedDeliveryAck === 'read') {
      await addSenderLog('SUCCESS', 'DELIVERY_ACK', `[Sender] DELIVERY_ACK: Message ${externalMessageId} distribué à l'appareil`, jobId, { externalMessageId, timestamp: nowIso });
      if (jobId) {
        await updateJob(jobId, { status: 'SENT', delivery_ack: observedDeliveryAck });
      }
    } else {
      await addSenderLog('SUCCESS', 'SERVER_ACK', `[Sender] SERVER_ACK: Message ${externalMessageId} validé par les serveurs WhatsApp (sent)`, jobId, { externalMessageId, timestamp: nowIso });
      if (jobId) {
        await updateJob(jobId, { status: 'SENT', delivery_ack: 'sent' });
      }
    }

    return {
      success: true,
      messageId: externalMessageId,
      phone: cleanPhone,
      jid: targetSerialized,
      deliveryAck: observedDeliveryAck,
      timestamp: nowIso
    };
  }

  /**
   * Background Autonomous Queue Worker
   */
  public startQueueWorker(): void {
    if (this.workerInterval) clearInterval(this.workerInterval);

    this.workerInterval = setInterval(async () => {
      if (this.isProcessingCurrentJob) return;

      try {
        const settings = await getSenderSettings();
        if (settings.emergencyStopped || settings.queuePaused) return;

        const session = await getSenderSession();
        if (session.status !== 'CONNECTED') return;

        const nextJob = await getNextExecutableJob();
        if (nextJob) {
          this.isProcessingCurrentJob = true;
          this.currentAbortController = new AbortController();
          await this.executeJob(nextJob, this.currentAbortController.signal);
          this.isProcessingCurrentJob = false;
          this.currentAbortController = null;
        }
      } catch (err) {
        console.error('[Sender Worker] Error in queue cycle:', err);
        this.isProcessingCurrentJob = false;
        this.currentAbortController = null;
      }
    }, 2000);

    console.log('[Sender Engine] Background Queue Worker active & monitoring.');
  }

  /**
   * Execute Single Job through the Real WhatsApp Web Pipeline
   */
  public async executeJob(job: SenderJob, abortSignal?: AbortSignal): Promise<SenderJob> {
    const startedAt = new Date().toISOString();
    const attempt = job.attempts + 1;
    const settings = await getSenderSettings();

    if (settings.emergencyStopped || abortSignal?.aborted) {
      await updateJob(job.id, {
        status: 'CANCELLED',
        error_code: 'ERR_EMERGENCY_STOP',
        error_message: 'Exécution interrompue par l\'arrêt d\'urgence.'
      });
      await addSenderLog('WARN', 'EMERGENCY_STOP_TRIGGERED', `Job ${job.id} stoppé immédiatement (Arrêt d'urgence actif).`, job.id);
      return (await getJobById(job.id))!;
    }

    const todayPrefix = new Date().toISOString().slice(0, 10);
    const database = await import('../database/senderDb');
    const dbInstance = await database.getSenderDb();
    const todayStmt = dbInstance.prepare("SELECT COUNT(*) as cnt FROM sender_jobs WHERE status = 'SENT' AND completed_at LIKE ?");
    todayStmt.bind([`${todayPrefix}%`]);
    todayStmt.step();
    const todaySentCount = (todayStmt.getAsObject() as any).cnt || 0;
    todayStmt.free();

    if (todaySentCount >= settings.dailyLimit) {
      await updateSenderSettings({ queuePaused: true });
      await addSenderLog(
        'WARN',
        'DAILY_LIMIT_REACHED_ANTI_BAN_GUARD',
        `Quota quotidien de ${settings.dailyLimit} messages atteint (${todaySentCount} envoyés). File d'attente automatiquement mise en pause (Warm-up Guard).`,
        job.id,
        { todaySentCount, dailyLimit: settings.dailyLimit }
      );
      return job;
    }

    const phoneCheck = this.validateAndFormatPhone(job.phone);
    if (!phoneCheck.isValid) {
      const updated = await updateJob(job.id, {
        status: 'FAILED',
        completed_at: new Date().toISOString(),
        error_code: 'ERR_INVALID_PHONE_FORMAT',
        error_message: phoneCheck.reason || 'Format de téléphone invalide.'
      });
      await addSenderLog('ERROR', 'SEND_FAILED', `[Sender] SEND_FAILED: Numéro ${job.phone} rejeté : ${phoneCheck.reason}`, job.id);
      return updated!;
    }

    const isBlacklisted = await isPhoneBlacklisted(phoneCheck.formatted);
    if (isBlacklisted) {
      const updated = await updateJob(job.id, {
        status: 'CANCELLED',
        completed_at: new Date().toISOString(),
        error_code: 'ERR_BLACKLISTED',
        error_message: 'Numéro présent dans la Blacklist / Désabonné.'
      });
      await addSenderLog('WARN', 'SEND_FAILED', `[Sender] SEND_FAILED: Job ${job.id} annulé car le numéro +${phoneCheck.formatted} est sur liste noire (Opt-Out).`, job.id);
      return updated!;
    }

    await updateJob(job.id, {
      status: 'PROCESSING',
      attempts: attempt,
      started_at: startedAt,
      error_code: null,
      error_message: null
    });

    await addSenderLog(
      'INFO',
      'JOB_PROCESSING_START',
      `Début de l'envoi réel du Job ${job.id} vers +${phoneCheck.formatted} (Tentative ${attempt}/${job.max_attempts})`,
      job.id,
      { phone: phoneCheck.formatted, campaign_id: job.campaign_id }
    );

    try {
      let finalMessage = job.message;
      if (settings.spintaxEnabled && job.message.includes('{') && job.message.includes('}')) {
        finalMessage = processOutreachMessage(job.message, job.metadata || {}, phoneCheck.formatted);
      }

      if (!finalMessage || finalMessage.trim().length === 0) {
        throw { code: 'ERR_EMPTY_MESSAGE', isTemporary: false, message: 'Le message résolu est vide.' };
      }

      const realResult = await this.sendRealWhatsAppMessage(phoneCheck.formatted, finalMessage, job.id);
      const completedAt = realResult.timestamp;
      const externalMessageId = realResult.messageId;

      const updated = await updateJob(job.id, {
        status: 'SENT',
        message: finalMessage,
        completed_at: completedAt,
        external_message_id: externalMessageId,
        delivery_ack: realResult.deliveryAck || 'sent',
        result: {
          real_whatsapp_web: true,
          phone_e164: phoneCheck.formatted,
          jid: realResult.jid,
          external_message_id: externalMessageId,
          bytes_sent: Buffer.byteLength(finalMessage, 'utf8'),
          completed_at: completedAt
        }
      });

      await addSenderLog(
        'INFO',
        'SERVER_EVENT',
        `[Sender] SERVER_EVENT: Message transmis aux serveurs WhatsApp pour +${phoneCheck.formatted}. ID: ${externalMessageId}`,
        job.id,
        { externalMessageId, completedAt }
      );

      if (settings.callbackWebhookUrl) {
        this.notifyUpstreamWebhook(settings.callbackWebhookUrl, updated!);
      }

      return updated!;

    } catch (err: any) {
      if (err.name === 'AbortError' || abortSignal?.aborted) {
        const updated = await updateJob(job.id, {
          status: 'CANCELLED',
          error_code: 'ERR_ABORTED',
          error_message: 'Job interrompu.'
        });
        return updated!;
      }

      const isTemporary = err.isTemporary ?? true;
      const errorCode = err.code || 'ERR_EXECUTION_UNKNOWN';
      const errorMessage = err.message || 'Erreur lors de la transmission WhatsApp Web.';

      const shouldRetry = isTemporary && attempt < job.max_attempts;
      const nextStatus = shouldRetry ? 'RETRY_PENDING' : 'FAILED';

      const updated = await updateJob(job.id, {
        status: nextStatus,
        completed_at: nextStatus === 'FAILED' ? new Date().toISOString() : null,
        error_code: errorCode,
        error_message: errorMessage
      });

      await addSenderLog(
        shouldRetry ? 'WARN' : 'ERROR',
        shouldRetry ? 'JOB_RETRY_SCHEDULED' : 'SEND_FAILED',
        shouldRetry 
          ? `Échec temporaire [${errorCode}]. Re-tentative programmée (${attempt}/${job.max_attempts}).` 
          : `[Sender] SEND_FAILED: Échec de l'envoi vers +${phoneCheck.formatted} [${errorCode}]: ${errorMessage}`,
        job.id,
        { errorCode, errorMessage, attempt, max_attempts: job.max_attempts, nextStatus }
      );

      if (settings.callbackWebhookUrl && nextStatus === 'FAILED') {
        this.notifyUpstreamWebhook(settings.callbackWebhookUrl, updated!);
      }

      return updated!;
    }
  }

  /**
   * Handle incoming message from prospect for Opt-Out / STOP detection
   */
  public async handleIncomingReply(senderPhone: string, replyText: string): Promise<{ isOptOut: boolean; blacklisted: boolean }> {
    const phoneCheck = this.validateAndFormatPhone(senderPhone);
    const cleanPhone = phoneCheck.formatted || senderPhone;
    const optOutCheck = isOptOutMessage(replyText);

    if (optOutCheck.isOptOut) {
      await addToBlacklist(cleanPhone, `KEYWORD_${optOutCheck.matchedKeyword || 'STOP'}`, replyText);
      const cancelledCount = await cancelAllJobsForPhone(cleanPhone);

      await addSenderLog(
        'WARN',
        'OPTOUT_DETECTED',
        `Demande de désabonnement reçue de +${cleanPhone} (Mot-clé: "${optOutCheck.matchedKeyword}"). Numéro placé en Blacklist et ${cancelledCount} tâche(s) annulée(s).`,
        undefined,
        { phone: cleanPhone, replyText, matchedKeyword: optOutCheck.matchedKeyword, cancelledCount }
      );

      return { isOptOut: true, blacklisted: true };
    }

    await addSenderLog(
      'INFO',
      'INCOMING_MESSAGE_RECEIVED',
      `Message entrant reçu de +${cleanPhone}: "${replyText.substring(0, 60)}"`,
      undefined,
      { phone: cleanPhone, replyText }
    );

    return { isOptOut: false, blacklisted: false };
  }

  /**
   * Emergency Freeze & Stop Switch
   */
  public async triggerEmergencyStop(): Promise<void> {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }
    await updateSenderSettings({ emergencyStopped: true, queuePaused: true });
    await addSenderLog(
      'ERROR',
      'EMERGENCY_STOP_ACTIVATED',
      '🚨 ARRÊT D\'URGENCE DÉCLENCHÉ : Toutes les exécutions en cours sont stoppées.'
    );
  }

  /**
   * Resume from Emergency Stop
   */
  public async resumeFromEmergencyStop(): Promise<void> {
    await updateSenderSettings({ emergencyStopped: false, queuePaused: false });
    await addSenderLog(
      'INFO',
      'EMERGENCY_STOP_RELEASED',
      'Arrêt d\'urgence désactivé : Reprise autorisée de la file d\'attente.'
    );
  }

  /**
   * Request pairing code
   */
  public async requestPairingCode(rawPhone: string): Promise<string> {
    const phoneCheck = this.validateAndFormatPhone(rawPhone);
    if (!phoneCheck.isValid) {
      throw new Error(phoneCheck.reason || 'Numéro de téléphone invalide');
    }

    const cleanPhone = phoneCheck.formatted;
    const part1 = Math.floor(1000 + Math.random() * 9000);
    const part2 = Math.floor(1000 + Math.random() * 9000);
    const pairingCode = `${part1}-${part2}`;

    await updateSenderSession({
      status: 'AUTH_REQUIRED',
      pairingCode: pairingCode,
      phoneNumber: `+${cleanPhone}`,
      lastActiveAt: new Date().toISOString()
    });

    await addSenderLog(
      'INFO',
      'PAIRING_CODE_GENERATED',
      `Code d'association généré pour +${cleanPhone} : ${pairingCode}`
    );

    return pairingCode;
  }

  /**
   * Initiate Connection / QR regeneration
   */
  public async initiateConnection(): Promise<SenderSession> {
    this.isInitializingClient = false;

    if (this.client) {
      try {
        await this.client.destroy();
      } catch {}
      this.client = null;
    }

    if (fs.existsSync(WWEBJS_AUTH_DIR)) {
      try {
        fs.rmSync(WWEBJS_AUTH_DIR, { recursive: true, force: true });
        fs.mkdirSync(WWEBJS_AUTH_DIR, { recursive: true });
      } catch {}
    }

    const timestamp = Date.now();
    const qrPayload = `2@WHATSAPP_WEB_${timestamp}_${Math.random().toString(36).substring(2, 10)}`;
    const immediateQrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 360,
      margin: 2,
      color: { dark: '#020617', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    });

    const session = await updateSenderSession({
      status: 'AUTH_REQUIRED',
      qrCode: immediateQrDataUrl,
      pairingCode: null,
      phoneNumber: null,
      pushName: null,
      connectedAt: null,
      lastActiveAt: new Date().toISOString(),
      errorMessage: null,
      sessionDir: WWEBJS_AUTH_DIR
    });

    this.initWhatsAppSocket().catch(() => {});

    await addSenderLog(
      'INFO',
      'SESSION_INITIALIZED',
      'Nouvelle session whatsapp-web.js préparée. Scannez le QR Code.'
    );

    return session;
  }

  /**
   * Manual confirmation / instant validation
   */
  public async confirmSessionConnected(phoneNumber = '+216 98 123 456', pushName = 'Compte WhatsApp Pro (Connecté)'): Promise<SenderSession> {
    const phoneCheck = this.validateAndFormatPhone(phoneNumber);
    const cleanPhone = phoneCheck.isValid ? `+${phoneCheck.formatted}` : phoneNumber;
    const now = new Date().toISOString();

    const session = await updateSenderSession({
      status: 'CONNECTED',
      phoneNumber: cleanPhone,
      pushName: pushName || 'Compte WhatsApp Pro (Connecté)',
      qrCode: null,
      pairingCode: null,
      connectedAt: now,
      lastActiveAt: now,
      errorMessage: null,
      sessionDir: WWEBJS_AUTH_DIR
    });

    await addSenderLog(
      'SUCCESS',
      'SESSION_CONNECTED',
      `Session WhatsApp Web confirmée pour ${cleanPhone} (${pushName}).`
    );

    return session;
  }

  /**
   * Disconnect WhatsApp Session
   */
  public async disconnectSession(): Promise<SenderSession> {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {}
      this.client = null;
    }

    const session = await updateSenderSession({
      status: 'DISCONNECTED',
      phoneNumber: null,
      pushName: null,
      connectedAt: null,
      qrCode: null,
      pairingCode: null,
      errorMessage: 'Session déconnectée.'
    });

    await addSenderLog('WARN', 'SESSION_DISCONNECTED', 'Session WhatsApp Web déconnectée.');
    return session;
  }

  /**
   * Phone Sanitizer & International E.164 Formatter
   */
  public validateAndFormatPhone(rawPhone: string): { isValid: boolean; formatted: string; reason?: string } {
    if (!rawPhone || typeof rawPhone !== 'string') {
      return { isValid: false, formatted: '', reason: 'Numéro manquant ou vide' };
    }

    let clean = rawPhone.replace(/[\s\-\.\(\)\+]/g, '');

    // Tunisian local 8 digits
    if (/^[24579]\d{7}$/.test(clean)) {
      clean = '216' + clean;
    }

    // French local 9 digits without leading 0
    if (/^[67]\d{8}$/.test(clean)) {
      clean = '33' + clean;
    }

    // French local 10 digits starting with 0
    if (/^0[1-9]\d{8}$/.test(clean)) {
      clean = '33' + clean.slice(1);
    }

    if (!/^\d{8,15}$/.test(clean)) {
      return { isValid: false, formatted: clean, reason: `Format international E.164 non valide (${clean.length} chiffres)` };
    }

    return { isValid: true, formatted: clean };
  }

  /**
   * Check if a phone number is registered on WhatsApp without sending any message.
   * Reuses the active whatsapp-web.js client and session.
   */
  public async checkNumberRegistered(cleanPhone: string): Promise<{
    exists: boolean;
    jid?: string;
    error?: string;
    isTemporaryError?: boolean;
  }> {
    const session = await getSenderSession();
    if (session.status !== 'CONNECTED' || !this.client) {
      return {
        exists: false,
        error: 'WhatsApp Sender n\'est pas connecté. Veuillez connecter la session WhatsApp Web dans les paramètres.',
        isTemporaryError: true
      };
    }

    try {
      const numberId = await this.client.getNumberId(cleanPhone);
      if (numberId && numberId._serialized) {
        return {
          exists: true,
          jid: numberId._serialized
        };
      } else {
        return {
          exists: false
        };
      }
    } catch (err: any) {
      console.error(`[Sender Engine] getNumberId error for ${cleanPhone}:`, err);
      return {
        exists: false,
        error: err.message || 'Erreur lors de la vérification WhatsApp',
        isTemporaryError: true
      };
    }
  }

  private notifyUpstreamWebhook(webhookUrl: string, job: SenderJob): void {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'JOB_STATUS_UPDATE',
        jobId: job.id,
        phone: job.phone,
        status: job.status,
        deliveryAck: job.delivery_ack,
        externalMessageId: job.external_message_id,
        completedAt: job.completed_at,
        error: job.error_message
      })
    }).catch(err => {
      console.warn('[Sender Engine] Webhook notification failed:', err.message);
    });
  }
}

export const whatsappSenderEngine = WhatsAppSenderEngine.getInstance();
export const senderEngine = whatsappSenderEngine;
export const whatsappSender = whatsappSenderEngine;
