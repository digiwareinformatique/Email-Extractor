/**
 * Express REST API Routes for WhatsApp Sender (Execution Engine)
 * Extended with Anti-Ban Guard, Spintax Preview, Blacklist & Emergency Kill Switch
 */
import { Router } from 'express';
import {
  createJob,
  updateJob,
  createBulkJobs,
  getJobById,
  listJobs,
  cancelJob,
  retryJob,
  retryAllFailedJobs,
  clearFinishedJobs,
  getSenderSession,
  getSenderSettings,
  updateSenderSettings,
  listSenderLogs,
  getSenderMetrics,
  addSenderLog,
  listBlacklist,
  addToBlacklist,
  removeFromBlacklist
} from '../database/senderDb';
import { senderEngine } from '../sender/whatsappSenderEngine';
import { generateSpintaxPreviews } from '../sender/spintaxEngine';
import { CreateJobInput, BulkCreateJobsInput } from '../../src/types/sender';

export const senderRouter = Router();

// 1. Overall Status & Metrics
senderRouter.get('/sender/status', async (req, res) => {
  try {
    const session = await getSenderSession();
    const metrics = await getSenderMetrics();
    const settings = await getSenderSettings();

    res.json({
      success: true,
      session,
      metrics,
      settings
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Ingest Jobs (Single or Bulk)
senderRouter.post('/sender/jobs', async (req, res) => {
  try {
    const body = req.body;

    if (Array.isArray(body.jobs)) {
      const bulkInput = body as BulkCreateJobsInput;
      if (bulkInput.jobs.length === 0) {
        res.status(400).json({ success: false, error: 'La liste des jobs est vide.' });
        return;
      }

      const sanitizedJobs: CreateJobInput[] = bulkInput.jobs.map(j => ({
        ...j,
        campaign_id: j.campaign_id || bulkInput.campaign_id,
        template_id: j.template_id || bulkInput.template_id,
      }));

      const result = await createBulkJobs(sanitizedJobs);
      await addSenderLog(
        'INFO',
        'JOBS_BULK_INGESTED',
        `Réception et mise en file d'attente de ${result.created} jobs automatisés pour la campagne [${bulkInput.campaign_id || 'DEFAULT'}]`,
        undefined,
        { count: result.created }
      );

      res.status(201).json({
        success: true,
        created: result.created,
        jobIds: result.jobIds,
        message: `${result.created} jobs ajoutés avec succès à la file d'attente automatisée.`
      });
      return;
    }

    // Single job
    const singleInput = body as CreateJobInput;
    if (!singleInput.phone) {
      res.status(400).json({ success: false, error: 'Le champ "phone" est obligatoire.' });
      return;
    }
    if (!singleInput.message) {
      res.status(400).json({ success: false, error: 'Le champ "message" est obligatoire.' });
      return;
    }

    const job = await createJob(singleInput);
    await addSenderLog(
      'INFO',
      'JOB_INGESTED',
      `[Sender] Job created: ${job.id} pour ${job.phone}`,
      job.id,
      { campaign_id: job.campaign_id, contact_id: job.contact_id }
    );

    res.status(201).json({
      success: true,
      job,
      message: `Job ${job.id} enregistré en statut PENDING.`
    });
  } catch (err: any) {
    console.error('[Sender API] Error creating job(s):', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2b. Direct Real Send for Unit Test (Immediate execution with real result)
senderRouter.post('/sender/test-send', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      res.status(400).json({ success: false, error: 'Numéro et message requis pour le test d\'envoi.' });
      return;
    }

    // Create raw job (no spintax, exact message)
    const job = await createJob({
      phone,
      message,
      campaign_id: 'TEST_DIRECT_REAL',
      metadata: { rawMessage: true, testSend: true }
    });

    console.log(`[Sender] Immediate Test Send requested for Job ${job.id}`);
    await addSenderLog('INFO', 'TEST_SEND_REQUESTED', `[Sender] Job created: ${job.id} (Test direct pour ${phone})`, job.id);

    // Execute immediately via engine
    const executedJob = await senderEngine.executeJob(job);

    const logs = await listSenderLogs(30, job.id);

    res.json({
      success: executedJob.status === 'SENT',
      job: executedJob,
      logs,
      message: executedJob.status === 'SENT' 
        ? '✓ MESSAGE ENVOYÉ avec succès via WhatsApp Web.' 
        : `✕ ÉCHEC DE L'ENVOI: ${executedJob.error_message || 'Erreur inconnue'}`
    });
  } catch (err: any) {
    console.error('[Sender API] Error in test-send:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. List Jobs with Filters
senderRouter.get('/sender/jobs', async (req, res) => {
  try {
    const { status, campaign_id, search, limit, offset } = req.query;

    const result = await listJobs({
      status: status as any,
      campaign_id: campaign_id as string,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0
    });

    res.json({
      success: true,
      jobs: result.jobs,
      total: result.total
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Get Job by ID with Execution Logs
senderRouter.get('/sender/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = await getJobById(id);

    if (!job) {
      res.status(404).json({ success: false, error: `Job ${id} introuvable.` });
      return;
    }

    const logs = await listSenderLogs(50, id);

    res.json({
      success: true,
      job,
      logs
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Cancel Job
senderRouter.post('/sender/jobs/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    await cancelJob(id);
    await addSenderLog('WARN', 'JOB_CANCELLED', `Le job ${id} a été annulé manuellement.`, id);
    const updated = await getJobById(id);
    res.json({ success: true, job: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Retry Single Job
senderRouter.post('/sender/jobs/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;
    await retryJob(id);
    await addSenderLog('INFO', 'JOB_MANUAL_RETRY', `Relance programmée pour le job ${id}.`, id);
    const updated = await getJobById(id);
    res.json({ success: true, job: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Bulk Retry Failed Jobs
senderRouter.post('/sender/jobs/bulk-retry', async (req, res) => {
  try {
    const retriedCount = await retryAllFailedJobs();
    await addSenderLog('INFO', 'BULK_RETRY_TRIGGERED', `Relance globale effectuée sur ${retriedCount} jobs.`);
    res.json({ success: true, retriedCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Queue Controls (Pause / Resume / Clear)
senderRouter.post('/sender/queue/pause', async (req, res) => {
  try {
    await updateSenderSettings({ queuePaused: true });
    await addSenderLog('WARN', 'QUEUE_PAUSED', 'File d\'attente mise en pause par l\'opérateur.');
    res.json({ success: true, isQueuePaused: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/queue/resume', async (req, res) => {
  try {
    await updateSenderSettings({ queuePaused: false, emergencyStopped: false });
    await addSenderLog('INFO', 'QUEUE_RESUMED', 'File d\'attente relancée par l\'opérateur.');
    res.json({ success: true, isQueuePaused: false });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/queue/clear', async (req, res) => {
  try {
    const deletedCount = await clearFinishedJobs();
    await addSenderLog('INFO', 'QUEUE_CLEARED', `Nettoyage de la file : ${deletedCount} jobs terminés purgés.`);
    res.json({ success: true, deletedCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Emergency Stop (Kill Switch)
senderRouter.post('/sender/emergency-stop', async (req, res) => {
  try {
    await senderEngine.triggerEmergencyStop();
    res.json({ success: true, message: 'Arrêt d\'urgence déclenché avec succès.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/emergency-resume', async (req, res) => {
  try {
    await senderEngine.resumeFromEmergencyStop();
    res.json({ success: true, message: 'Arrêt d\'urgence désactivé. Reprise autorisée.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Blacklist Endpoints
senderRouter.get('/sender/blacklist', async (req, res) => {
  try {
    const blacklist = await listBlacklist();
    res.json({ success: true, blacklist });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/blacklist', async (req, res) => {
  try {
    const { phone, reason } = req.body;
    if (!phone) {
      res.status(400).json({ success: false, error: 'Numéro requis.' });
      return;
    }
    const entry = await addToBlacklist(phone, reason || 'MANUAL_ADD');
    await addSenderLog('WARN', 'MANUAL_BLACKLIST_ADD', `Numéro ${phone} ajouté manuellement à la blacklist.`);
    res.json({ success: true, entry });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.delete('/sender/blacklist/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    await removeFromBlacklist(phone);
    await addSenderLog('INFO', 'BLACKLIST_REMOVE', `Numéro ${phone} retiré de la blacklist.`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Simulate Incoming Reply (Opt-out tester)
senderRouter.post('/sender/simulate-reply', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      res.status(400).json({ success: false, error: 'Phone et Message requis pour tester la réponse entrante.' });
      return;
    }
    const result = await senderEngine.handleIncomingReply(phone, message);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Spintax Preview Generator
senderRouter.post('/sender/spintax/preview', async (req, res) => {
  try {
    const { template, count } = req.body;
    if (!template) {
      res.status(400).json({ success: false, error: 'Template requis.' });
      return;
    }
    const variations = generateSpintaxPreviews(template, count || 5);
    res.json({ success: true, original: template, variations });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Session Management (Connect, Confirm, Disconnect)
senderRouter.post('/sender/session/connect', async (req, res) => {
  try {
    const session = await senderEngine.initiateConnection();
    res.json({ success: true, session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/session/confirm', async (req, res) => {
  try {
    const { phoneNumber, pushName } = req.body;
    const session = await senderEngine.confirmSessionConnected(
      phoneNumber || '+216 98 123 456',
      pushName || 'Session WhatsApp Web (Active)'
    );
    res.json({ success: true, session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/session/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ success: false, error: 'Numéro de téléphone requis pour générer le code d\'association.' });
      return;
    }
    const code = await senderEngine.requestPairingCode(phoneNumber);
    const session = await getSenderSession();
    res.json({ success: true, pairingCode: code, session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/session/disconnect', async (req, res) => {
  try {
    const session = await senderEngine.disconnectSession();
    res.json({ success: true, session });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Technical Audit Logs
senderRouter.get('/sender/logs', async (req, res) => {
  try {
    const { limit, jobId } = req.query;
    const logs = await listSenderLogs(
      limit ? parseInt(limit as string, 10) : 100,
      jobId as string
    );
    res.json({ success: true, logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15. Settings (Get / Update)
senderRouter.get('/sender/settings', async (req, res) => {
  try {
    const settings = await getSenderSettings();
    res.json({ success: true, settings });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

senderRouter.post('/sender/settings', async (req, res) => {
  try {
    const updated = await updateSenderSettings(req.body);
    await addSenderLog('INFO', 'SETTINGS_UPDATED', 'Paramètres d\'exécution Anti-Ban mis à jour.');
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// 16. Real Single Test Message Endpoint (WhatsApp Web Direct Dispatch)
senderRouter.post('/sender/real-send-test', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone) {
      res.status(400).json({ success: false, error: 'Numéro de téléphone requis.' });
      return;
    }

    const testMessage = (message && message.trim().length > 0) ? message.trim() : 'Test réel WhatsApp Sender.';

    const phoneCheck = senderEngine.validateAndFormatPhone(phone);
    if (!phoneCheck.isValid) {
      res.status(400).json({ success: false, error: phoneCheck.reason || 'Numéro de téléphone invalide.' });
      return;
    }

    // Create a job for tracking
    const job = await createJob({
      phone: phoneCheck.formatted,
      message: testMessage,
      campaign_id: 'REAL_TEST_SINGLE',
      metadata: { source: 'real_test_direct_ui', target_phone: phoneCheck.formatted }
    });

    try {
      const realResult = await senderEngine.sendRealWhatsAppMessage(phoneCheck.formatted, testMessage, job.id);

      const completedAt = realResult.timestamp;
      const updatedJob = await updateJob(job.id, {
        status: 'SENT',
        completed_at: completedAt,
        external_message_id: realResult.messageId,
        delivery_ack: realResult.deliveryAck || 'sent', // 'sent' represents accepted by WhatsApp server; 'delivered' is updated on real receipt event
        result: {
          real_whatsapp_web: true,
          phone_e164: phoneCheck.formatted,
          jid: realResult.jid,
          external_message_id: realResult.messageId,
          delivery_ack: realResult.deliveryAck || 'sent',
          completed_at: completedAt
        }
      });

      await addSenderLog(
        'INFO',
        'SERVER_EVENT',
        `[Sender] SERVER_EVENT: Message de test transmis aux serveurs WhatsApp pour +${phoneCheck.formatted}. ID: ${realResult.messageId} (Statut: Envoyé — En attente d'accusé de livraison)`,
        job.id,
        { externalMessageId: realResult.messageId, phone: phoneCheck.formatted, message: testMessage, deliveryAck: realResult.deliveryAck || 'sent' }
      );

      const jobLogs = await listSenderLogs(50, job.id);

      res.json({
        success: true,
        messageId: realResult.messageId,
        phone: phoneCheck.formatted,
        message: testMessage,
        deliveryAck: realResult.deliveryAck || 'sent',
        timestamp: completedAt,
        job: updatedJob,
        details: realResult,
        logs: jobLogs
      });
    } catch (sendErr: any) {
      const errorCode = sendErr.code || 'ERR_WHATSAPP_SEND_FAILED';
      const errorMessage = sendErr.message || 'Erreur lors de l\'envoi WhatsApp Web';

      const failedJob = await updateJob(job.id, {
        status: 'FAILED',
        completed_at: new Date().toISOString(),
        error_code: errorCode,
        error_message: errorMessage
      });

      await addSenderLog(
        'ERROR',
        'SEND_FAILED',
        `[Sender] SEND_FAILED: Échec de l'envoi de test vers +${phoneCheck.formatted} [${errorCode}]: ${errorMessage}`,
        job.id,
        { errorCode, errorMessage }
      );

      const jobLogs = await listSenderLogs(50, job.id);

      res.status(400).json({
        success: false,
        errorCode,
        error: errorMessage,
        jobId: job.id,
        job: failedJob,
        logs: jobLogs
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

