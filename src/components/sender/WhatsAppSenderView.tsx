/**
 * WhatsApp Business Sender - Workspace Moderne d'Exécution & Synchronisation V2
 * Multi-Language (FR / EN), Instant Update & Sync Engine, Anti-Ban Shield, Spintax & Live Session
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send,
  Upload,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Zap,
  Activity,
  Phone,
  RefreshCw,
  QrCode,
  Smartphone,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  UserX,
  Plus,
  Flame,
  Layers,
  FileText,
  Key,
  Copy,
  Check,
  ListFilter,
  ChevronDown,
  ChevronRight,
  Download,
  Save,
  Globe,
  Sliders,
  CheckCheck,
  FileCheck,
  MessageSquare,
  HelpCircle,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SenderJob,
  SenderSession,
  SenderSettings,
  SenderMetrics,
  SenderLog,
  SenderJobStatus,
  BlacklistEntry,
  CreateJobInput
} from '../../types/sender';
import { senderApi } from '../../services/senderApi';
import { ContactListUploader } from './ContactListUploader';
import QRCode from 'qrcode';

type ActiveTab = 'STUDIO' | 'QUEUE' | 'SESSION' | 'ANTIBAN' | 'BLACKLIST' | 'LOGS';
type Language = 'fr' | 'en';

export const WhatsAppSenderView: React.FC = () => {
  // Language State: 'fr' or 'en'
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('wa_sender_lang');
      if (saved === 'en' || saved === 'fr') return saved;
    } catch (e) {}
    return 'fr';
  });

  const handleToggleLang = (newLang: Language) => {
    setLang(newLang);
    try {
      localStorage.setItem('wa_sender_lang', newLang);
    } catch (e) {}
  };

  // Navigation & Core States
  const [activeTab, setActiveTab] = useState<ActiveTab>('STUDIO');
  const [session, setSession] = useState<SenderSession | null>(null);
  const [metrics, setMetrics] = useState<SenderMetrics | null>(null);
  const [settings, setSettings] = useState<SenderSettings | null>(null);
  const [settingsForm, setSettingsForm] = useState<Partial<SenderSettings>>({});
  const [jobs, setJobs] = useState<SenderJob[]>([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [logs, setLogs] = useState<SenderLog[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<SenderJobStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>(() => new Date().toLocaleTimeString());
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  // Spintax & Studio States
  const [spintaxInput, setSpintaxInput] = useState(
    '{Bonjour|Salut|Enchanté} {nom},\n\n{Saviez-vous que 80% des cracks Windows et Office KMS exposent les entreprises à des fuites de données ?|DigiWare vous accompagne dans la conformité de vos licences professionnelles.}\n\nTestez vos postes en 5 secondes avec la commande CMD : slmgr /dli\n\nLicences 100% officielles (Windows 11 Pro, Office 2024 Pro Plus, Kaspersky) avec facture légale et matricule fiscal tunisien.\n\nCordialement,\nL\'équipe DigiWare Tunisie'
  );
  const [spintaxVariations, setSpintaxVariations] = useState<string[]>([]);
  const [isSpintaxLoading, setIsSpintaxLoading] = useState(false);
  const [quickPhone, setQuickPhone] = useState('+216 98 456 789');
  const [quickName, setQuickName] = useState('Cabinet d\'Avocats');
  const [quickCompany, setQuickCompany] = useState('Conseil Juridique');
  const [quickCity, setQuickCity] = useState('Tunis');
  const [quickCampaign, setQuickCampaign] = useState('CAMP_AUDIT_KMS');
  const [studioMode, setStudioMode] = useState<'UPLOAD' | 'QUICK'>('UPLOAD');

  // Real Unit Test Send State
  const [testPhone, setTestPhone] = useState('+216 98 123 456');
  const [testMessage, setTestMessage] = useState('Test de synchronisation WhatsApp Business Sender.');
  const [isTestingSend, setIsTestingSend] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    job?: SenderJob;
    logs?: SenderLog[];
    message?: string;
  } | null>(null);

  // Session Connection
  const [directPhone, setDirectPhone] = useState('+216 98 123 456');
  const [directPushName, setDirectPushName] = useState('Session WhatsApp Pro');
  const [sessionMethod, setSessionMethod] = useState<'QR' | 'PAIRING_CODE' | 'DIRECT'>('QR');
  const [pairingPhone, setPairingPhone] = useState('+216 98 123 456');
  const [pairingCodeResult, setPairingCodeResult] = useState<string | null>(null);
  const [isRequestingPairingCode, setIsRequestingPairingCode] = useState(false);

  // Blacklist form & simulation
  const [newBlacklistPhone, setNewBlacklistPhone] = useState('');
  const [newBlacklistReason, setNewBlacklistReason] = useState('MANUAL_ADD');
  const [simPhone, setSimPhone] = useState('+216 98 000 111');
  const [simMessage, setSimMessage] = useState('STOP');
  const [simResult, setSimResult] = useState<string | null>(null);

  // Selected Job modal
  const [selectedJob, setSelectedJob] = useState<SenderJob | null>(null);
  const [selectedJobLogs, setSelectedJobLogs] = useState<SenderLog[]>([]);

  // Logs & Clipboard
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const t = {
    fr: {
      title: 'WhatsApp Business Sender',
      badge: 'Moteur Pro & Sync Temps Réel',
      subtitle: 'Workspace unifié d’envoi automatisé, bouclier anti-ban intelligent et synchronisation directe WhatsApp Web.',
      syncAndUpdate: 'Synchroniser & Mettre à jour',
      updateNow: 'Mettre à jour maintenant',
      refreshStatus: 'Actualiser le statut',
      pendingChangesNotice: 'Vous avez des modifications en attente d’application.',
      lastUpdate: 'Dernière mise à jour :',
      allSynced: 'Tout est synchronisé',
      pendingCount: 'modification(s) à appliquer',
      pauseQueue: 'Mettre en pause',
      resumeQueue: 'Reprendre la file',
      emergencyStop: 'Arrêt d’urgence',
      emergencyResume: 'Débloquer l’arrêt',
      tabStudio: '1. Studio de Campagne & Envoi',
      tabQueue: '2. File d’Attente & Suivi',
      tabSession: '3. Session WhatsApp Web',
      tabAntiBan: '4. Bouclier Anti-Ban & Quotas',
      tabBlacklist: '5. Blacklist & Opt-Out',
      tabLogs: '6. Journal Stanza & Traçabilité',
      statusConnected: 'Connecté',
      statusDisconnected: 'Déconnecté',
      statusAuthRequired: 'Scan QR requis',
      statusConnecting: 'Connexion en cours...',
      todaySent: 'Envoyés aujourd’hui',
      dailyQuota: 'Quota max / jour',
      successRate: 'Taux de succès',
      activeQueue: 'File d’attente',
      delayRange: 'Délai anti-ban',
      downloadZip: 'Télécharger (.zip)',
      cancel: 'Annuler',
      saveAndApply: 'Enregistrer & Mettre à jour'
    },
    en: {
      title: 'WhatsApp Business Sender',
      badge: 'Pro Engine & Real-Time Sync',
      subtitle: 'Unified automated dispatch workspace, smart anti-ban shield, and direct WhatsApp Web synchronization.',
      syncAndUpdate: 'Sync & Update',
      updateNow: 'Update Now',
      refreshStatus: 'Refresh Status',
      pendingChangesNotice: 'You have pending modifications waiting to be applied.',
      lastUpdate: 'Last updated:',
      allSynced: 'All synchronized',
      pendingCount: 'pending modification(s)',
      pauseQueue: 'Pause Queue',
      resumeQueue: 'Resume Queue',
      emergencyStop: 'Emergency Kill-Switch',
      emergencyResume: 'Unlock Emergency',
      tabStudio: '1. Campaign Studio & Send',
      tabQueue: '2. Live Queue & Execution',
      tabSession: '3. WhatsApp Web Session',
      tabAntiBan: '4. Anti-Ban Shield & Quotas',
      tabBlacklist: '5. Blacklist & Opt-Out',
      tabLogs: '6. Stanza Live Logs & Trace',
      statusConnected: 'Connected',
      statusDisconnected: 'Disconnected',
      statusAuthRequired: 'QR Scan Required',
      statusConnecting: 'Connecting...',
      todaySent: 'Sent Today',
      dailyQuota: 'Max Daily Quota',
      successRate: 'Success Rate',
      activeQueue: 'Active Queue',
      delayRange: 'Anti-Ban Delay',
      downloadZip: 'Download (.zip)',
      cancel: 'Cancel',
      saveAndApply: 'Save & Update Now'
    }
  }[lang];

  const notify = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 5000);
  };

  const copyTextToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      notify(lang === 'fr' ? 'Copié dans le presse-papiers avec succès !' : 'Copied to clipboard successfully!', 'success');
      setTimeout(() => setCopiedKey(null), 3000);
    } catch {
      notify(lang === 'fr' ? 'Impossible de copier le contenu' : 'Could not copy to clipboard', 'error');
    }
  };

  // Poll Core Engine Data
  const fetchEngineData = useCallback(async (isManualTrigger = false) => {
    try {
      if (isManualTrigger) setIsSyncing(true);
      const statusRes = await senderApi.getStatus();
      setSession(statusRes.session);
      setMetrics(statusRes.metrics);
      setSettings(statusRes.settings);
      
      // Only overwrite form if not actively dirty
      setSettingsForm(prev => {
        if (!hasPendingChanges) return statusRes.settings;
        return prev;
      });

      const jobsRes = await senderApi.getJobs({
        status: statusFilter,
        search: searchQuery,
        limit: 50
      });
      setJobs(jobsRes.jobs);
      setTotalJobs(jobsRes.total);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err: any) {
      if (err.message !== 'SERVEUR_EN_COURS_DE_DEMARRAGE') {
        console.warn('[WhatsApp Business Sender] Polling notice:', err.message);
      }
    } finally {
      setIsLoading(false);
      if (isManualTrigger) setIsSyncing(false);
    }
  }, [statusFilter, searchQuery, hasPendingChanges]);

  useEffect(() => {
    fetchEngineData();
    const interval = setInterval(() => fetchEngineData(false), 3500);
    return () => clearInterval(interval);
  }, [fetchEngineData]);

  // Load secondary lists when tab switches
  useEffect(() => {
    if (activeTab === 'LOGS') {
      senderApi.getLogs(80).then(setLogs).catch(() => {});
    } else if (activeTab === 'BLACKLIST') {
      senderApi.getBlacklist().then(setBlacklist).catch(() => {});
    }
  }, [activeTab]);

  // Canvas Fallback for QR Code
  useEffect(() => {
    if (session?.status === 'AUTH_REQUIRED' && qrCanvasRef.current) {
      const canvas = qrCanvasRef.current;
      const payload = session.qrCode || `2@WHATSAPP_BUSINESS_SENDER_${Date.now()}`;
      QRCode.toCanvas(canvas, payload, {
        width: 240,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' }
      }).catch(() => {});
    }
  }, [session?.status, session?.qrCode]);

  // ---------------------------------------------------------------------------
  // Radical Actions: "Mettre à jour" & "Synchroniser et Mettre à jour"
  // ---------------------------------------------------------------------------
  
  const handleSyncAndUpdate = async () => {
    try {
      setIsSyncing(true);
      // 1. If any pending settings changes exist, save them first
      if (hasPendingChanges && settingsForm) {
        const updated = await senderApi.updateSettings(settingsForm);
        setSettings(updated);
        setHasPendingChanges(false);
      }
      // 2. Fetch fresh engine data, jobs, status, metrics
      await fetchEngineData(true);
      // 3. Update logs if on logs tab
      if (activeTab === 'LOGS') {
        const freshLogs = await senderApi.getLogs(80);
        setLogs(freshLogs);
      } else if (activeTab === 'BLACKLIST') {
        const freshBl = await senderApi.getBlacklist();
        setBlacklist(freshBl);
      }
      setLastUpdated(new Date().toLocaleTimeString());
      notify(
        lang === 'fr' 
          ? '✓ Synchronisation et mise à jour complètes effectuées avec succès !' 
          : '✓ Full synchronization and update completed successfully!',
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Erreur lors de la synchronisation', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUpdateNow = async () => {
    try {
      setActionLoading('update-now');
      if (settingsForm) {
        const updated = await senderApi.updateSettings(settingsForm);
        setSettings(updated);
      }
      setHasPendingChanges(false);
      await fetchEngineData(true);
      notify(
        lang === 'fr'
          ? '✓ Vos modifications ont été enregistrées et mises à jour avec succès !'
          : '✓ All modifications saved and updated successfully!',
        'success'
      );
    } catch (err: any) {
      notify(err.message || 'Erreur lors de la mise à jour', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSettingChange = (key: keyof SenderSettings, value: any) => {
    setSettingsForm(prev => ({ ...prev, [key]: value }));
    setHasPendingChanges(true);
  };

  const handleRevertChanges = () => {
    if (settings) {
      setSettingsForm(settings);
    }
    setHasPendingChanges(false);
    notify(lang === 'fr' ? 'Modifications annulées' : 'Modifications reverted', 'info');
  };

  // Additional Sender Actions
  const handleToggleQueuePause = async () => {
    if (!metrics) return;
    try {
      setActionLoading('queue-toggle');
      if (metrics.isQueuePaused) {
        await senderApi.resumeQueue();
        notify(lang === 'fr' ? 'File d’attente reprise. Envois actifs.' : 'Queue resumed. Dispatch active.', 'success');
      } else {
        await senderApi.pauseQueue();
        notify(lang === 'fr' ? 'File d’attente mise en pause.' : 'Queue paused.', 'info');
      }
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEmergencyStop = async () => {
    try {
      setActionLoading('emergency');
      await senderApi.triggerEmergencyStop();
      notify(
        lang === 'fr'
          ? '🚨 ARRÊT D’URGENCE DÉCLENCHÉ : Exécutions interrompues et file d’attente gelée !'
          : '🚨 EMERGENCY KILL-SWITCH TRIGGERED: Dispatch frozen!',
        'error'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEmergencyResume = async () => {
    try {
      setActionLoading('resume');
      await senderApi.resumeFromEmergencyStop();
      notify(
        lang === 'fr'
          ? 'Reprise autorisée : File d’attente et worker réactivés.'
          : 'Resume authorized: Queue and background worker reactivated.',
        'success'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryAll = async () => {
    try {
      setActionLoading('retry-all');
      const count = await senderApi.retryAllFailed();
      notify(
        lang === 'fr'
          ? `${count} jobs en échec replacés en file d’attente.`
          : `${count} failed jobs placed back into queue.`,
        'success'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearFinished = async () => {
    try {
      setActionLoading('clear-finished');
      const count = await senderApi.clearFinished();
      notify(
        lang === 'fr'
          ? `${count} jobs terminés purgés de la file.`
          : `${count} completed jobs cleared from queue.`,
        'info'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleConnectSession = async () => {
    try {
      setActionLoading('connect');
      const updated = await senderApi.connectSession();
      setSession(updated);
      notify(
        lang === 'fr'
          ? 'Session Stealth initialisée. Prête pour l’appairage.'
          : 'Stealth session initialized. Ready for pairing.',
        'info'
      );
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmSession = async () => {
    try {
      setActionLoading('confirm-session');
      const updated = await senderApi.confirmSession(directPhone, directPushName);
      setSession(updated);
      notify(
        lang === 'fr'
          ? `Session WhatsApp Web confirmée pour ${directPhone}.`
          : `WhatsApp Web session confirmed for ${directPhone}.`,
        'success'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRequestPairingCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pairingPhone.trim()) return;
    try {
      setIsRequestingPairingCode(true);
      const res = await senderApi.requestPairingCode(pairingPhone);
      setPairingCodeResult(res.pairingCode);
      notify(
        lang === 'fr'
          ? `Code d’association généré : ${res.pairingCode}`
          : `Pairing code generated: ${res.pairingCode}`,
        'success'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message || 'Erreur lors de la génération du code', 'error');
    } finally {
      setIsRequestingPairingCode(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setActionLoading('disconnect');
      const updated = await senderApi.disconnectSession();
      setSession(updated);
      notify(
        lang === 'fr'
          ? 'Session WhatsApp Web déconnectée.'
          : 'WhatsApp Web session disconnected.',
        'info'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateSpintax = async () => {
    if (!spintaxInput.trim()) return;
    try {
      setIsSpintaxLoading(true);
      const res = await senderApi.previewSpintax(spintaxInput, 4);
      setSpintaxVariations(res.variations || []);
      notify(
        lang === 'fr'
          ? '4 variations Spintax uniques générées avec succès !'
          : '4 unique Spintax variations generated successfully!',
        'success'
      );
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setIsSpintaxLoading(false);
    }
  };

  const handleQuickSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPhone.trim() || !spintaxInput.trim()) return;
    try {
      setActionLoading('quick-send');
      await senderApi.createJob({
        phone: quickPhone,
        message: spintaxInput,
        campaign_id: quickCampaign.trim() || 'CAMP_STUDIO',
        metadata: {
          nom: quickName.trim() || 'Monsieur/Madame',
          entreprise: quickCompany.trim() || '',
          ville: quickCity.trim() || '',
          source: 'WhatsApp Business Sender Studio'
        }
      });
      notify(
        lang === 'fr'
          ? `Message pour ${quickPhone} injecté dans la file d'attente automatisée !`
          : `Message for ${quickPhone} injected into the automated queue!`,
        'success'
      );
      await fetchEngineData();
      setActiveTab('QUEUE');
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleInjectBulkContacts = async (bulkJobs: CreateJobInput[]) => {
    try {
      setActionLoading('bulk-inject');
      const res = await senderApi.createBulkJobs(bulkJobs, quickCampaign.trim() || 'CAMP_BULK_UPLOAD');
      notify(
        lang === 'fr'
          ? `✓ ${res.created} contacts importés et injectés avec succès dans la file d'attente automatisée !`
          : `✓ ${res.created} contacts successfully imported and injected into the send queue!`,
        'success'
      );
      await fetchEngineData();
      setActiveTab('QUEUE');
    } catch (err: any) {
      notify(err.message || 'Erreur lors de l’injection des contacts', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecuteRealTestSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!testPhone.trim() || !testMessage.trim()) return;
    try {
      setIsTestingSend(true);
      setTestResult(null);
      const res = await senderApi.testSend(testPhone, testMessage);
      setTestResult(res);
      if (res.success) {
        notify(
          lang === 'fr'
            ? '✓ MESSAGE TEST RÉEL ENVOYÉ avec succès dans WhatsApp Web !'
            : '✓ REAL TEST MESSAGE SENT successfully in WhatsApp Web!',
          'success'
        );
      } else {
        notify(
          lang === 'fr'
            ? `✕ Échec du test : ${res.job?.error_message || res.message || 'Erreur'}`
            : `✕ Test failed: ${res.job?.error_message || res.message || 'Error'}`,
          'error'
        );
      }
      await fetchEngineData();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Erreur d’envoi'
      });
      notify(err.message, 'error');
    } finally {
      setIsTestingSend(false);
    }
  };

  const handleInjectDemoContacts = async () => {
    try {
      setActionLoading('demo-inject');
      const demoJobs = [
        {
          phone: '+216 98 111 222',
          message: '{Bonjour|Salut|Enchanté} Maître {nom},\n\n{Pour tester la conformité de vos postes informatiques|Dans le cadre de l\'audit de sécurité de votre cabinet}, tapez dans l\'invite de commande CMD :\n👉 slmgr /dli\n\nDigiWare vous fournit les clés 100% officielles Microsoft Office 2024 Pro Plus et Windows 11 avec facture légale tunisienne.\n\nCordialement,\nDigiWare Informatique',
          campaign_id: 'CAMP_AUDIT_KMS',
          metadata: { nom: 'Ben Salem', company: 'Cabinet d\'Avocats Ben Salem', city: 'Tunis' }
        },
        {
          phone: '+216 98 333 444',
          message: '{Bonjour|Bonjour l\'équipe} {nom},\n\nDigiWare distribue les clés logicielles certifiées pour entreprises :\n• Windows 11 Pro Retail\n• Office 2024 Pro Plus\n• Kaspersky Total Security\n\nFacture légale avec matricule fiscal déductible.\n\nSouhaitez-vous notre grille tarifaire entreprise ?\n\nBien à vous,\nDigiWare',
          campaign_id: 'CAMP_OFFICIEL_B2B',
          metadata: { nom: 'Cabinet Expert Comptable', company: 'Expertise Comptable', city: 'Sfax' }
        },
        {
          phone: '+216 98 555 666',
          message: '{Bonjour|Salut confrère} {nom},\n\nVous réalisez de la maintenance ou de la vente de matériel informatique ? DigiWare vous propose des packs de clés logicielles à tarifs grossistes pour revendeurs.\n\nL\'équipe DigiWare',
          campaign_id: 'CAMP_REVENDEURS',
          metadata: { nom: 'Atelier IT', company: 'Informatique Pro', city: 'Sousse' }
        }
      ];
      await senderApi.createBulkJobs(demoJobs, 'CAMP_DEMO_DIGIWARE', 'TPL_DEMO');
      notify(
        lang === 'fr'
          ? '3 prospects de démonstration B2B injectés dans la file d’attente !'
          : '3 demo B2B prospects injected into the queue!',
        'success'
      );
      await fetchEngineData();
      setActiveTab('QUEUE');
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddToBlacklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlacklistPhone.trim()) return;
    try {
      setActionLoading('add-bl');
      const entry = await senderApi.addToBlacklist(newBlacklistPhone, newBlacklistReason);
      setBlacklist([entry, ...blacklist]);
      setNewBlacklistPhone('');
      notify(
        lang === 'fr'
          ? `Numéro ${entry.phone} ajouté à la Blacklist. Tâches associées annulées.`
          : `Number ${entry.phone} added to Blacklist. Pending tasks cancelled.`,
        'success'
      );
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFromBlacklist = async (phone: string) => {
    try {
      await senderApi.removeFromBlacklist(phone);
      setBlacklist(blacklist.filter(b => b.phone !== phone));
      notify(lang === 'fr' ? `Numéro ${phone} retiré de la Blacklist.` : `Number ${phone} removed from Blacklist.`, 'info');
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleSimulateReply = async () => {
    if (!simPhone.trim() || !simMessage.trim()) return;
    try {
      const res = await senderApi.simulateReply(simPhone, simMessage);
      if (res.isOptOut) {
        setSimResult(
          lang === 'fr'
            ? `🚨 OPT-OUT DÉTECTÉ ! Le numéro ${simPhone} a été immédiatement ajouté à la Blacklist et toutes ses tâches ont été annulées.`
            : `🚨 OPT-OUT DETECTED! Number ${simPhone} was automatically added to Blacklist and pending tasks cancelled.`
        );
      } else {
        setSimResult(
          lang === 'fr'
            ? `ℹ️ Message normal reçu de ${simPhone}. Aucun mot-clé d'arrêt détecté.`
            : `ℹ️ Standard message received from ${simPhone}. No stop keyword detected.`
        );
      }
      senderApi.getBlacklist().then(setBlacklist).catch(() => {});
      await fetchEngineData();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30">
      
      {/* ------------------------------------------------------------- */}
      {/* RADICAL TOP COMMAND & SYNCHRONIZATION BAR                     */}
      {/* ------------------------------------------------------------- */}
      <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur-md px-4 sm:px-6 py-3.5 sticky top-0 z-40 shadow-xl">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          
          {/* Left: Branding & Language Switcher */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-lg shadow-emerald-950/60 ring-2 ring-emerald-500/30 shrink-0">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {t.title}
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                  {t.badge}
                </span>

                {/* FR / EN Language Toggle ("l'anglais WhatsApp Business Sender") */}
                <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 ml-1">
                  <button
                    onClick={() => handleToggleLang('fr')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      lang === 'fr' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Interface en Français"
                  >
                    🇫🇷 FR
                  </button>
                  <button
                    onClick={() => handleToggleLang('en')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      lang === 'en' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="English Interface (WhatsApp Business Sender)"
                  >
                    🇬🇧 EN
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{t.lastUpdate} {lastUpdated}</span>
                </span>
                <span>•</span>
                {hasPendingChanges ? (
                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{t.pendingCount}</span>
                  </span>
                ) : (
                  <span className="text-emerald-400 font-medium flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" />
                    <span>{t.allSynced}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: The High-Priority "Mettre à jour" & "Synchroniser" Action Center */}
          <div className="flex items-center gap-2.5 flex-wrap">
            
            {/* 1. PRIMARY BIG BUTTON: "Synchroniser & Mettre à jour" */}
            <button
              onClick={handleSyncAndUpdate}
              disabled={isSyncing}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer ${
                isSyncing
                  ? 'bg-emerald-800 text-emerald-200 opacity-80 cursor-wait'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/60 hover:shadow-emerald-900/80 active:scale-98 ring-2 ring-emerald-400/40'
              }`}
              title="Synchronise instantanément l'état WhatsApp Web, applique les modifications et rafraîchit la file d'attente"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{t.syncAndUpdate}</span>
            </button>

            {/* 2. PRIMARY ACTION BUTTON: "Mettre à jour" (illuminates if changes pending) */}
            <button
              onClick={handleUpdateNow}
              disabled={actionLoading === 'update-now'}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold border transition-all cursor-pointer ${
                hasPendingChanges
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-300 shadow-lg shadow-amber-950/60 animate-bounce'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
              title="Enregistre et applique immédiatement tous les paramètres et messages modifiés"
            >
              <Save className="w-4 h-4" />
              <span>{t.updateNow}</span>
              {hasPendingChanges && (
                <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
              )}
            </button>

            {/* 3. Session Connection Badge / Trigger */}
            <button
              onClick={() => setActiveTab('SESSION')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                session?.status === 'CONNECTED'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/40'
                  : 'bg-amber-950/60 border-amber-500/40 text-amber-300 hover:bg-amber-900/40'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${
                session?.status === 'CONNECTED'
                  ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : 'bg-amber-400 animate-ping'
              }`} />
              <span className="font-mono">
                {session?.status === 'CONNECTED'
                  ? (session.phoneNumber || 'WhatsApp Web Connecté')
                  : t.statusDisconnected}
              </span>
            </button>

            {/* 4. Pause / Resume Queue */}
            <button
              onClick={handleToggleQueuePause}
              disabled={actionLoading === 'queue-toggle' || metrics?.emergencyStopped}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border cursor-pointer ${
                metrics?.isQueuePaused
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700/80'
              }`}
              title="Suspendre ou relancer automatiquement le traitement de la file d'attente"
            >
              {metrics?.isQueuePaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
              <span>{metrics?.isQueuePaused ? t.resumeQueue : t.pauseQueue}</span>
            </button>

            {/* 5. Emergency Stop / Kill-Switch */}
            {metrics?.emergencyStopped ? (
              <button
                onClick={handleEmergencyResume}
                disabled={actionLoading === 'resume'}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-lg shadow-emerald-950/50 border border-emerald-400 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{t.emergencyResume}</span>
              </button>
            ) : (
              <button
                onClick={handleEmergencyStop}
                disabled={actionLoading === 'emergency'}
                className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-red-950/40 text-red-300 border border-red-500/40 hover:bg-red-900/50 flex items-center gap-1.5 transition-all cursor-pointer"
                title="Geler immédiatement tous les envois et stopper le moteur d'exécution"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                <span className="hidden sm:inline">{t.emergencyStop}</span>
              </button>
            )}

            {/* 6. Download ZIP */}
            <a
              href="/api/download-project-zip"
              download="whatsapp-sender-project.zip"
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5 border border-slate-700 transition-all cursor-pointer"
              title="Télécharger l'archive complète du projet WhatsApp Sender"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
            </a>
          </div>

        </div>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* FLOATING ACTION BAR FOR PENDING MODIFICATIONS                 */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {hasPendingChanges && (
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white p-3.5 rounded-2xl border-2 border-emerald-500 shadow-2xl flex items-center gap-4 max-w-lg ring-4 ring-emerald-950/60"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="text-xs">
              <span className="font-bold block text-slate-100">{t.pendingChangesNotice}</span>
              <span className="text-slate-400">Cliquez ci-dessous pour appliquer et synchroniser.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncAndUpdate}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t.syncAndUpdate}</span>
              </button>
              <button
                onClick={handleRevertChanges}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                title={t.cancel}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- */}
      {/* NOTIFICATION TOAST                                            */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-6 z-50 max-w-md"
          >
            <div className={`p-4 rounded-xl shadow-2xl border flex items-center gap-3 backdrop-blur-md ${
              notification.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-100 border-emerald-500/50'
                : notification.type === 'error'
                  ? 'bg-red-950/90 text-red-100 border-red-500/50'
                  : 'bg-slate-900/90 text-slate-100 border-slate-700'
            }`}>
              {notification.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : notification.type === 'error' ? (
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              ) : (
                <Activity className="w-5 h-5 text-blue-400 shrink-0" />
              )}
              <span className="text-xs font-medium leading-relaxed">{notification.text}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------- */}
      {/* EMERGENCY STOP BANNER IF ACTIVATED                           */}
      {/* ------------------------------------------------------------- */}
      {metrics?.emergencyStopped && (
        <div className="bg-red-950 border-b border-red-800 px-6 py-3 text-red-200 flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-400 animate-pulse" />
            <span>Moteur WhatsApp Business Sender verrouillé par l’Arrêt d’Urgence. Tous les envois sont suspendus.</span>
          </div>
          <button
            onClick={handleEmergencyResume}
            className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            {t.emergencyResume}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MAIN WORKSPACE BODY                                          */}
      {/* ------------------------------------------------------------- */}
      <main className="max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6 flex-1">
        
        {/* EXECUTIVE KPI STRIP (4 CARDS) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: Session Status */}
          <div 
            onClick={() => setActiveTab('SESSION')}
            className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition-all cursor-pointer shadow-lg group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>Session WhatsApp</span>
              <Smartphone className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${
                session?.status === 'CONNECTED' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-amber-400'
              }`} />
              <span className="text-base font-bold text-white font-mono truncate">
                {session?.status === 'CONNECTED' ? (session.phoneNumber || 'Connecté') : 'Non connecté'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {session?.status === 'CONNECTED' ? 'Synchronisé avec WhatsApp Web' : 'Cliquez pour appairer le QR code'}
            </p>
          </div>

          {/* Card 2: Queue Progress */}
          <div 
            onClick={() => setActiveTab('QUEUE')}
            className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition-all cursor-pointer shadow-lg group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>{t.activeQueue}</span>
              <Layers className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">
                {metrics?.pendingCount || 0}
              </span>
              <span className="text-xs text-slate-400">
                en attente / {totalJobs} total
              </span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all"
                style={{
                  width: totalJobs > 0 
                    ? `${Math.min(100, Math.round(((metrics?.sentCount || 0) / totalJobs) * 100))}%` 
                    : '0%'
                }}
              />
            </div>
          </div>

          {/* Card 3: Anti-Ban Shield */}
          <div 
            onClick={() => setActiveTab('ANTIBAN')}
            className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition-all cursor-pointer shadow-lg group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>{t.delayRange}</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-emerald-300 font-mono">
                {settings?.minDelaySeconds || 45}s – {settings?.maxDelaySeconds || 110}s
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Bouclier furtif & variation Spintax active
            </p>
          </div>

          {/* Card 4: Daily Quota & Success */}
          <div 
            onClick={() => setActiveTab('STUDIO')}
            className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition-all cursor-pointer shadow-lg group"
          >
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
              <span>{t.todaySent}</span>
              <Flame className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">
                {metrics?.todaySentCount || 0}
              </span>
              <span className="text-xs text-slate-400">
                / {metrics?.dailyLimit || 50} max
              </span>
            </div>
            <p className="text-[11px] text-emerald-400 font-medium mt-1">
              Taux de succès : {metrics?.successRate || 100}%
            </p>
          </div>
        </div>

        {/* WORKSPACE NAVIGATION TABS */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 text-xs no-scrollbar">
          {[
            { id: 'STUDIO', label: t.tabStudio, icon: <Sparkles className="w-4 h-4 text-emerald-400" /> },
            { id: 'QUEUE', label: t.tabQueue, icon: <Layers className="w-4 h-4 text-blue-400" />, badge: metrics?.pendingCount },
            { id: 'SESSION', label: t.tabSession, icon: <QrCode className="w-4 h-4 text-teal-400" /> },
            { id: 'ANTIBAN', label: t.tabAntiBan, icon: <ShieldCheck className="w-4 h-4 text-amber-400" /> },
            { id: 'BLACKLIST', label: t.tabBlacklist, icon: <UserX className="w-4 h-4 text-red-400" />, badge: blacklist.length },
            { id: 'LOGS', label: t.tabLogs, icon: <Activity className="w-4 h-4 text-indigo-400" /> }
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/60'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                    isActive ? 'bg-emerald-900 text-white' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ============================================================= */}
        {/* TAB 1: STUDIO DE CAMPAGNE & PUPITRE D'ENVOI EN BOUCLE         */}
        {/* ============================================================= */}
        {activeTab === 'STUDIO' && (
          <div className="space-y-6">

            {/* Studio Mode Switcher: Pupitre d'Upload vs Envoi Rapide */}
            <div className="flex bg-slate-900 border border-slate-800 p-1.5 rounded-2xl gap-2 shadow-lg">
              <button
                onClick={() => setStudioMode('UPLOAD')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  studioMode === 'UPLOAD'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Upload className="w-4 h-4 text-emerald-300" />
                <span>
                  {lang === 'fr' 
                    ? '📂 Pupitre d’Upload & Envoi en Boucle (Excel, CSV, VCF, Listes)' 
                    : '📂 Broadcast & Contact List Upload Desk (Excel, CSV, VCF, Lists)'}
                </span>
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold">
                  Mass Send
                </span>
              </button>

              <button
                onClick={() => setStudioMode('QUICK')}
                className={`py-2.5 px-5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                  studioMode === 'QUICK'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Zap className="w-4 h-4 text-purple-300" />
                <span>
                  {lang === 'fr' 
                    ? '⚡ Envoi Rapide & Test Réel' 
                    : '⚡ Quick Send & Unit Real Test'}
                </span>
              </button>
            </div>

            {/* Message & Spintax Composer (Shared by both modes) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-white">
                      {lang === 'fr' ? '1. Modèle de Message & Spintax de la Campagne' : '1. Campaign Message Template & Spintax'}
                    </h2>
                    <p className="text-xs text-slate-400">
                      {lang === 'fr' 
                        ? 'Chaque contact recevra ce message personnalisé avec ses variables et une variation aléatoire anti-ban.' 
                        : 'Each contact receives this customized message with their variables and a random anti-ban variation.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Campaign ID input */}
                  <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-500 font-mono">Campagne:</span>
                    <input
                      type="text"
                      value={quickCampaign}
                      onChange={(e) => setQuickCampaign(e.target.value)}
                      placeholder="CAMP_B2B_AUDIT"
                      className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none w-32"
                    />
                  </div>

                  {/* Demo prospects injector button */}
                  <button
                    onClick={handleInjectDemoContacts}
                    disabled={actionLoading === 'demo-inject'}
                    className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-all cursor-pointer"
                    title="Injecter 3 prospects B2B de test dans la file d'attente"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Prospects Démo (+3)</span>
                  </button>
                </div>
              </div>

              {/* Spintax Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-300 font-semibold">
                    {lang === 'fr' ? 'Corps du message (Spintax compatible) :' : 'Message body (Spintax compatible):'}
                  </label>
                  <span className="text-[11px] text-slate-500">
                    Variables injectées : <code className="text-emerald-400 font-mono">{'{nom}'}</code>, <code className="text-emerald-400 font-mono">{'{entreprise}'}</code>, <code className="text-emerald-400 font-mono">{'{ville}'}</code>
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={spintaxInput}
                  onChange={(e) => {
                    setSpintaxInput(e.target.value);
                    setHasPendingChanges(true);
                  }}
                  placeholder="Tapez votre message ici avec {Bonjour|Salut}..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-xs sm:text-sm text-slate-200 font-mono focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>

              {/* Spintax Actions */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  onClick={handleGenerateSpintax}
                  disabled={isSpintaxLoading}
                  className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{lang === 'fr' ? 'Tester 4 Variations Aléatoires' : 'Test 4 Random Variations'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSyncAndUpdate}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t.syncAndUpdate}</span>
                  </button>
                </div>
              </div>

              {/* Spintax Variations Output */}
              {spintaxVariations.length > 0 && (
                <div className="space-y-2.5 pt-3 border-t border-slate-800">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    {lang === 'fr' ? 'Variations Spintax générées en direct :' : 'Live Spintax variations generated:'}
                  </span>
                  <div className="space-y-2">
                    {spintaxVariations.map((v, i) => (
                      <div key={i} className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-xs font-mono text-slate-300">
                        <span className="text-[10px] text-emerald-400 font-bold block mb-1">Variation #{i + 1} :</span>
                        {v}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* MODE 1: UPLOAD CONTACT LIST (PUPITRE D'ENVOI EN BOUCLE) */}
            {studioMode === 'UPLOAD' && (
              <ContactListUploader
                lang={lang}
                campaignId={quickCampaign}
                messageTemplate={spintaxInput}
                onInjectContacts={handleInjectBulkContacts}
              />
            )}

            {/* MODE 2: QUICK SEND & REAL TEST */}
            {studioMode === 'QUICK' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                
                {/* Quick Send Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
                      <Send className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white">Envoi Rapide Vers la File (1 Contact)</h2>
                      <p className="text-xs text-slate-400">Injectez manuellement un destinataire dans le moteur automatisé.</p>
                    </div>
                  </div>

                  <form onSubmit={handleQuickSend} className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Numéro WhatsApp (+216...)</label>
                      <input
                        type="text"
                        value={quickPhone}
                        onChange={(e) => setQuickPhone(e.target.value)}
                        placeholder="+216 98 123 456"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs font-mono text-white"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">Nom / Titre</label>
                        <input
                          type="text"
                          value={quickName}
                          onChange={(e) => setQuickName(e.target.value)}
                          placeholder="Ex: Maître Dupont"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-300 block mb-1">Société</label>
                        <input
                          type="text"
                          value={quickCompany}
                          onChange={(e) => setQuickCompany(e.target.value)}
                          placeholder="Ex: Cabinet Audit"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={actionLoading === 'quick-send'}
                      className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      <span>Mettre à jour & Injecter dans la File</span>
                    </button>
                  </form>
                </div>

                {/* Direct Real Unit Test Box */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-white">Test d’Envoi Réel Unitaire</h2>
                      <p className="text-xs text-slate-400">Vérifiez la livraison directe sur votre propre smartphone.</p>
                    </div>
                  </div>

                  <form onSubmit={handleExecuteRealTestSend} className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Votre numéro mobile de test :</label>
                      <input
                        type="text"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Message test :</label>
                      <input
                        type="text"
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isTestingSend}
                      className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-md"
                    >
                      {isTestingSend ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      <span>Lancer le Test WhatsApp Réel</span>
                    </button>
                  </form>

                  {testResult && (
                    <div className={`p-3 rounded-xl border text-xs font-mono ${
                      testResult.success ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' : 'bg-red-950/60 border-red-500/40 text-red-300'
                    }`}>
                      {testResult.success ? '✓ Stanza WhatsApp Web transmise avec succès !' : `✕ ${testResult.message}`}
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 2: FILE D'ATTENTE & SUIVI (LIVE QUEUE)                    */}
        {/* ============================================================= */}
        {activeTab === 'QUEUE' && (
          <div className="space-y-4">
            
            {/* Controls Bar for Queue */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xl">
              
              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {(['ALL', 'PENDING', 'PROCESSING', 'SENT', 'FAILED'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      statusFilter === st
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st === 'ALL' ? 'Tous' : st}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleRetryAll}
                  disabled={actionLoading === 'retry-all'}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Relancer les Échecs</span>
                </button>

                <button
                  onClick={handleClearFinished}
                  disabled={actionLoading === 'clear-finished'}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>Purger Terminés</span>
                </button>

                {/* Big Update Button inside Tab */}
                <button
                  onClick={handleSyncAndUpdate}
                  disabled={isSyncing}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Mettre à jour la File</span>
                </button>
              </div>

            </div>

            {/* Jobs List */}
            {jobs.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
                <Layers className="w-10 h-10 mx-auto text-slate-600" />
                <h3 className="text-base font-bold text-slate-200">Aucun job dans la file d'attente</h3>
                <p className="text-xs max-w-md mx-auto">
                  La file d'attente est actuellement vide ou aucun job ne correspond à votre filtre. Injectez des prospects depuis le Studio ou l'Extracteur WhatsApp.
                </p>
                <button
                  onClick={() => setActiveTab('STUDIO')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Aller au Studio & Créer des Jobs</span>
                </button>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="divide-y divide-slate-800">
                  {jobs.map(job => (
                    <div 
                      key={job.id} 
                      className="p-4 hover:bg-slate-800/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            job.status === 'SENT' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' :
                            job.status === 'FAILED' ? 'bg-red-950 text-red-300 border border-red-500/30' :
                            job.status === 'PROCESSING' ? 'bg-blue-950 text-blue-300 border border-blue-500/30 animate-pulse' :
                            'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}>
                            {job.status}
                          </span>
                          <span className="text-sm font-bold text-white font-mono">
                            +{job.phone}
                          </span>
                          {job.metadata?.nom && (
                            <span className="text-xs text-slate-400">
                              ({job.metadata.nom})
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500 font-mono">
                            {job.id}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 font-mono line-clamp-1">
                          {job.message}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-start md:self-auto">
                        {job.status === 'FAILED' && (
                          <button
                            onClick={async () => {
                              await senderApi.retryJob(job.id);
                              fetchEngineData();
                            }}
                            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                          >
                            Relancer
                          </button>
                        )}
                        {(job.status === 'PENDING' || job.status === 'PROCESSING') && (
                          <button
                            onClick={async () => {
                              await senderApi.cancelJob(job.id);
                              fetchEngineData();
                            }}
                            className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                          >
                            Annuler
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            setSelectedJob(job);
                            const res = await senderApi.getJobById(job.id);
                            setSelectedJobLogs(res.logs || []);
                          }}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        >
                          Détails
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 3: SESSION WHATSAPP WEB                                  */}
        {/* ============================================================= */}
        {activeTab === 'SESSION' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Connexion & Synchronisation WhatsApp Web</h2>
                    <p className="text-xs text-slate-400">Appairez votre session pour l’envoi direct et la synchronisation en tâche de fond.</p>
                  </div>
                </div>

                <button
                  onClick={handleSyncAndUpdate}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Synchroniser Session</span>
                </button>
              </div>

              {/* Status Header */}
              <div className={`p-4 rounded-xl border flex items-center justify-between ${
                session?.status === 'CONNECTED'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-500/40 text-amber-300'
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`w-3.5 h-3.5 rounded-full ${
                    session?.status === 'CONNECTED' ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)] animate-pulse' : 'bg-amber-400 animate-ping'
                  }`} />
                  <div>
                    <span className="font-bold block text-sm">
                      {session?.status === 'CONNECTED' ? 'Session WhatsApp Web Active' : 'Session en attente d’appairage'}
                    </span>
                    <span className="text-xs opacity-80">
                      {session?.status === 'CONNECTED' ? `Numéro : ${session.phoneNumber || 'Prêt'}` : 'Scannez le QR Code ou utilisez le code à 8 chiffres'}
                    </span>
                  </div>
                </div>

                {session?.status === 'CONNECTED' && (
                  <button
                    onClick={handleDisconnect}
                    className="px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    Déconnecter
                  </button>
                )}
              </div>

              {/* Methods Switcher: QR or Pairing Code */}
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  onClick={() => setSessionMethod('QR')}
                  className={`flex-1 py-2 font-bold rounded-lg transition-all cursor-pointer ${
                    sessionMethod === 'QR' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Scanner le QR Code
                </button>
                <button
                  onClick={() => setSessionMethod('PAIRING_CODE')}
                  className={`flex-1 py-2 font-bold rounded-lg transition-all cursor-pointer ${
                    sessionMethod === 'PAIRING_CODE' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Code d’association à 8 chiffres
                </button>
                <button
                  onClick={() => setSessionMethod('DIRECT')}
                  className={`flex-1 py-2 font-bold rounded-lg transition-all cursor-pointer ${
                    sessionMethod === 'DIRECT' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Mode Stealth Pro
                </button>
              </div>

              {/* View Method QR */}
              {sessionMethod === 'QR' && (
                <div className="flex flex-col items-center justify-center p-6 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                  <div className="bg-white p-3 rounded-2xl shadow-xl">
                    <canvas ref={qrCanvasRef} width={240} height={240} />
                  </div>
                  <div className="text-center text-xs text-slate-400 space-y-1">
                    <p className="font-semibold text-slate-200">1. Ouvrez WhatsApp sur votre smartphone</p>
                    <p>2. Allez dans Menu / Réglages &gt; Appareils connectés</p>
                    <p>3. Appuyez sur « Connecter un appareil » et visez ce code QR</p>
                  </div>
                  <button
                    onClick={handleConnectSession}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    Régénérer le QR Code
                  </button>
                </div>
              )}

              {/* View Method Pairing Code */}
              {sessionMethod === 'PAIRING_CODE' && (
                <div className="p-6 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                  <form onSubmit={handleRequestPairingCode} className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Votre numéro mobile (+216...)</label>
                      <input
                        type="text"
                        value={pairingPhone}
                        onChange={(e) => setPairingPhone(e.target.value)}
                        placeholder="+216 98 123 456"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isRequestingPairingCode}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md"
                    >
                      {isRequestingPairingCode ? 'Génération du code...' : 'Générer le Code d’Association'}
                    </button>
                  </form>

                  {pairingCodeResult && (
                    <div className="p-4 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-center space-y-2">
                      <span className="text-xs text-emerald-300 font-semibold block">Code à saisir dans WhatsApp :</span>
                      <span className="text-2xl font-mono font-bold tracking-widest text-white bg-slate-900 px-4 py-2 rounded-xl inline-block border border-emerald-500/40">
                        {pairingCodeResult}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* View Method Direct Stealth */}
              {sessionMethod === 'DIRECT' && (
                <div className="p-6 bg-slate-950 rounded-2xl border border-slate-800 space-y-4">
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Numéro de session Stealth :</label>
                      <input
                        type="text"
                        value={directPhone}
                        onChange={(e) => setDirectPhone(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Nom d’affichage :</label>
                      <input
                        type="text"
                        value={directPushName}
                        onChange={(e) => setDirectPushName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <button
                      onClick={handleConfirmSession}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md"
                    >
                      Confirmer la Session Directe
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 4: BOUCLIER ANTI-BAN & PARAMÈTRES DE SÉCURITÉ             */}
        {/* ============================================================= */}
        {activeTab === 'ANTIBAN' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Bouclier Anti-Ban & Paramètres de Sécurité</h2>
                    <p className="text-xs text-slate-400">Régulez les délais aléatoires et les quotas pour protéger vos numéros WhatsApp.</p>
                  </div>
                </div>

                {/* Big Button to Save & Update Settings */}
                <button
                  onClick={handleUpdateNow}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg transition-all cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{t.saveAndApply}</span>
                </button>
              </div>

              {/* Sliders & Inputs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Delay Minimum */}
                <div className="space-y-2 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-bold text-slate-200">Délai Minimum entre envois :</label>
                    <span className="font-mono text-emerald-400 font-bold">{settingsForm.minDelaySeconds || 45} secondes</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={120}
                    step={5}
                    value={settingsForm.minDelaySeconds || 45}
                    onChange={(e) => handleSettingChange('minDelaySeconds', Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-500">Temps de pause minimum garanti après chaque message.</p>
                </div>

                {/* Delay Maximum */}
                <div className="space-y-2 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-bold text-slate-200">Délai Maximum entre envois :</label>
                    <span className="font-mono text-emerald-400 font-bold">{settingsForm.maxDelaySeconds || 110} secondes</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={300}
                    step={10}
                    value={settingsForm.maxDelaySeconds || 110}
                    onChange={(e) => handleSettingChange('maxDelaySeconds', Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-500">Une valeur aléatoire est choisie entre le min et le max pour simuler l'humain.</p>
                </div>

                {/* Daily Quota Limit */}
                <div className="space-y-2 p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-bold text-slate-200">Limite Journalière Maximale :</label>
                    <span className="font-mono text-amber-400 font-bold">{settingsForm.dailyLimit || 50} messages / jour</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={500}
                    step={10}
                    value={settingsForm.dailyLimit || 50}
                    onChange={(e) => handleSettingChange('dailyLimit', Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-500">Recommandé pour un compte récent (warm-up) : 30 à 60/jour.</p>
                </div>

                {/* Human Typing Simulation */}
                <div className="space-y-2 p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-slate-200 block">Simulation d'Écriture Humaine</label>
                    <p className="text-[11px] text-slate-500">Affiche « En train d'écrire... » pendant quelques secondes avant l'envoi.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settingsForm.humanTypingSimulation !== false}
                    onChange={(e) => handleSettingChange('humanTypingSimulation', e.target.checked)}
                    className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                  />
                </div>

              </div>

              {/* Big Bottom Action to Save */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {hasPendingChanges ? '⚠️ N’oubliez pas de cliquer sur Mettre à jour pour sauvegarder.' : '✓ Tous les paramètres sont à jour sur le serveur.'}
                </span>

                <div className="flex items-center gap-3">
                  {hasPendingChanges && (
                    <button
                      onClick={handleRevertChanges}
                      className="px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
                    >
                      {t.cancel}
                    </button>
                  )}
                  <button
                    onClick={handleUpdateNow}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>Mettre à jour les Paramètres de Sécurité</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 5: BLACKLIST & DÉSINCRIPTIONS (OPT-OUT)                   */}
        {/* ============================================================= */}
        {activeTab === 'BLACKLIST' && (
          <div className="max-w-4xl mx-auto space-y-6">
            
            {/* Add to Blacklist Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
                    <UserX className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Blacklist & Protection Contre le Spam</h2>
                    <p className="text-xs text-slate-400">Les numéros blacklistés sont immédiatement ignorés par le moteur.</p>
                  </div>
                </div>

                <button
                  onClick={handleSyncAndUpdate}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Mettre à jour la Liste</span>
                </button>
              </div>

              {/* Form Add */}
              <form onSubmit={handleAddToBlacklist} className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <input
                  type="text"
                  value={newBlacklistPhone}
                  onChange={(e) => setNewBlacklistPhone(e.target.value)}
                  placeholder="+216 98 000 000"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-white"
                  required
                />
                <input
                  type="text"
                  value={newBlacklistReason}
                  onChange={(e) => setNewBlacklistReason(e.target.value)}
                  placeholder="Raison (Ex: Demande STOP)"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                />
                <button
                  type="submit"
                  disabled={actionLoading === 'add-bl'}
                  className="py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md"
                >
                  Ajouter à la Blacklist
                </button>
              </form>

              {/* Opt-out Simulator */}
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5 pt-3">
                <span className="text-xs font-bold text-slate-300 block">
                  Simulateur de détection automatique d'Opt-Out (STOP / Arrêt) :
                </span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={simPhone}
                    onChange={(e) => setSimPhone(e.target.value)}
                    placeholder="+216 98 000 111"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <input
                    type="text"
                    value={simMessage}
                    onChange={(e) => setSimMessage(e.target.value)}
                    placeholder="STOP"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                  <button
                    onClick={handleSimulateReply}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Simuler Réponse
                  </button>
                </div>
                {simResult && (
                  <p className="text-xs font-mono text-amber-300 bg-amber-950/40 p-2 rounded-lg border border-amber-500/30">
                    {simResult}
                  </p>
                )}
              </div>

              {/* Blacklist Table */}
              <div className="divide-y divide-slate-800 pt-2">
                <span className="text-xs font-bold text-slate-400 block pb-2">
                  {blacklist.length} numéro(s) actuellement inscrits en liste noire :
                </span>
                {blacklist.map(entry => (
                  <div key={entry.phone} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono font-bold text-white block">+{entry.phone}</span>
                      <span className="text-slate-500 text-[11px]">{entry.reason}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveFromBlacklist(entry.phone)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Supprimer
                    </button>
                  </div>
                ))}
              </div>

            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 6: JOURNAL STANZA & TRAÇABILITÉ (LOGS)                   */}
        {/* ============================================================= */}
        {activeTab === 'LOGS' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Journal Stanza & Événements Temps Réel</h2>
                  <p className="text-xs text-slate-400">Consultez l'historique chronologique des acquittements de distribution WhatsApp Web.</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const text = logs.map(l => `[${l.created_at}] [${l.event}] (${l.level}): ${l.message}`).join('\n');
                    copyTextToClipboard(text, 'all-logs');
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copier les Logs</span>
                </button>
                <button
                  onClick={handleSyncAndUpdate}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Mettre à jour</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 font-mono text-xs max-h-[600px] overflow-y-auto space-y-2">
              {logs.length === 0 ? (
                <p className="text-slate-500 text-center py-8">Aucun log récent enregistré.</p>
              ) : (
                logs.map(log => (
                  <div key={log.id} className="p-2.5 bg-slate-950 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        log.level === 'SUCCESS' ? 'bg-emerald-950 text-emerald-300' :
                        log.level === 'ERROR' ? 'bg-red-950 text-red-300' :
                        log.level === 'WARN' ? 'bg-amber-950 text-amber-300' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {log.level}
                      </span>
                      <span className="text-slate-400 text-[11px]">[{new Date(log.created_at).toLocaleTimeString()}]</span>
                      <span className="text-slate-200">{log.message}</span>
                    </div>
                    {log.jobId && (
                      <span className="text-[10px] text-slate-500 font-mono self-start sm:self-auto">
                        Job: {log.jobId}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      </main>

      {/* ------------------------------------------------------------- */}
      {/* JOB DETAILS MODAL                                             */}
      {/* ------------------------------------------------------------- */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Détails du Job {selectedJob.id}</h3>
                <p className="text-xs text-slate-400">Destinataire : +{selectedJob.phone}</p>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 block font-semibold">Message :</span>
                <p className="p-3 bg-slate-950 rounded-xl font-mono text-slate-200 mt-1">{selectedJob.message}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-400 block font-semibold">Statut :</span>
                  <span className="font-bold text-white font-mono">{selectedJob.status}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold">Tentatives :</span>
                  <span className="text-white">{selectedJob.attempts} / {selectedJob.max_attempts}</span>
                </div>
              </div>
              {selectedJob.error_message && (
                <div className="p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-300 font-mono">
                  Erreur : {selectedJob.error_message}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedJob(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
