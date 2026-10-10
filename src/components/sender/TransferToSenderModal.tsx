/**
 * TransferToSenderModal
 * Seamless Interconnection Bridge between Extractor Modules and WhatsApp Sender
 * Pre-loaded with DigiWare's B2B Educational Outreach & Audit Campaign Presets
 */
import React, { useState } from 'react';
import {
  Send,
  XCircle,
  Sparkles,
  CheckCircle2,
  Users,
  MessageSquare,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  FileCode,
  Briefcase
} from 'lucide-react';
import { senderApi } from '../../services/senderApi';
import { CreateJobInput } from '../../types/sender';

export interface TransferTargetContact {
  phone: string;
  name?: string;
  id?: string;
  company?: string;
  city?: string;
  category?: string;
}

interface TransferToSenderModalProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: TransferTargetContact[];
  sourceModuleName: string;
  onNavigateToSender?: () => void;
}

const DIGIWARE_TEMPLATES = [
  {
    id: 'DIGIWARE_KMS_AUDIT',
    title: '🛡️ Audit Failles KMS (Avocats, Cabinets, Comptables)',
    campaignId: 'CAMP_AUDIT_KMS',
    template: `{Bonjour|Salut|Enchanté} {nom},\n\n{Saviez-vous que 80% des cracks Windows et Office KMS exposent les cabinets à des fuites de données confidentielles ?|Dans le cadre de la protection des données de votre cabinet...}\n\nPour tester la conformité de vos postes en 5 secondes, ouvrez l'invite de commande (CMD) et tapez :\n👉 slmgr /dli\n\nSi une adresse KMS tierce ou un serveur d'activation externe apparaît, votre système présente une vulnérabilité.\n\nDigiWare vous fournit les licences 100% officielles (Windows 11 Pro, Office 2024 Pro Plus, Kaspersky) avec facture légale et matricule fiscal tunisien.\n\n{Souhaitez-vous recevoir notre catalogue entreprise ?|Puis-je vous faire parvenir notre grille tarifaire pro ?}\n\nCordialement,\nL’équipe DigiWare Tunisie`
  },
  {
    id: 'DIGIWARE_OFFICIAL_SOFTWARE',
    title: '💼 Offre Logiciels & Clés Officielles (B2B / Entreprises)',
    campaignId: 'CAMP_LOGICIELS_B2B',
    template: `{Bonjour|Bonjour l'équipe} {nom},\n\nDigiWare distribue les clés logicielles 100% officielles et authentiques pour les professionnels en Tunisie :\n• Windows 11 Pro & 10 Pro (Clé OEM / Retail liée à votre carte mère)\n• Microsoft Office 2024 & 2021 Professionnel Plus\n• Kaspersky Total Security & Antivirus\n\n✅ Facture légale avec matricule fiscal tunisien déductible.\n✅ Activation en ligne immédiate et support d'installation garanti.\n\n{Seriez-vous intéressé par un devis pour votre parc informatique ?|Puis-je vous transmettre nos tarifs dégressifs pour entreprises ?}\n\nBien à vous,\nDigiWare Informatique`
  },
  {
    id: 'DIGIWARE_RESELLER_PRO',
    title: '🤝 Offre Revendeurs & Prestataires Informatiques',
    campaignId: 'CAMP_REVENDEURS_IT',
    template: `{Bonjour|Salut confrère} {nom},\n\nVous réalisez de la maintenance informatique ou de la vente de PC ?\n\nDigiWare propose aux prestataires et revendeurs tunisiens des packs de clés de licences officielles à tarifs grossistes (Windows, Office, Antivirus) avec facturation certifiée.\n\n{Aimeriez-vous tester nos clés sur vos prochaines installations ?|Souhaitez-vous recevoir notre grille grossiste revendeur ?}\n\nL'équipe DigiWare`
  },
  {
    id: 'CUSTOM_TEMPLATE',
    title: '✏️ Message Personnalisé Libre (Spintax compatible)',
    campaignId: 'CAMP_CUSTOM',
    template: `{Bonjour|Salut|Enchanté} {nom},\n\n{Suite à la consultation de votre fiche professionnelle|Je me permets de vous contacter concernant votre activité}.\n\nBien cordialement,\nL’équipe DigiWare`
  }
];

export const TransferToSenderModal: React.FC<TransferToSenderModalProps> = ({
  isOpen,
  onClose,
  contacts,
  sourceModuleName,
  onNavigateToSender
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState(DIGIWARE_TEMPLATES[0].id);
  const [campaignId, setCampaignId] = useState(DIGIWARE_TEMPLATES[0].campaignId);
  const [templateId, setTemplateId] = useState(DIGIWARE_TEMPLATES[0].id);
  const [messageTemplate, setMessageTemplate] = useState(DIGIWARE_TEMPLATES[0].template);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{ created: number; jobIds: string[] } | null>(null);

  if (!isOpen) return null;

  // Filter contacts with valid phone number
  const validContacts = contacts.filter(c => c.phone && c.phone.trim().length >= 8);

  const handleSelectPreset = (presetId: string) => {
    const found = DIGIWARE_TEMPLATES.find(p => p.id === presetId);
    if (found) {
      setSelectedPresetId(found.id);
      setCampaignId(found.campaignId);
      setTemplateId(found.id);
      setMessageTemplate(found.template);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validContacts.length === 0 || !messageTemplate.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      // Build individual jobs
      const jobs: CreateJobInput[] = validContacts.map((c, idx) => {
        const contactName = c.name && c.name !== 'Inconnu' ? c.name : 'Monsieur/Madame';
        return {
          contact_id: c.id || `C-${idx + 1}`,
          phone: c.phone,
          campaign_id: campaignId.trim() || 'CAMPAIGN_DEFAULT',
          template_id: templateId.trim() || 'TPL_DEFAULT',
          message: messageTemplate,
          metadata: {
            source: sourceModuleName,
            nom: contactName,
            name: contactName,
            entreprise: c.company || '',
            ville: c.city || '',
            specialite: c.category || '',
            transferred_at: new Date().toISOString()
          }
        };
      });

      const res = await senderApi.createBulkJobs(jobs, campaignId, templateId);
      setSuccessResult(res);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erreur lors du transfert vers le Sender');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-800 max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-800 text-white flex items-center justify-between border-b border-emerald-500/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-xl shadow-inner">
              <Send className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold tracking-tight">
                  Transférer vers WhatsApp Business Sender
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/20 uppercase tracking-wider">
                  DigiWare B2B
                </span>
              </div>
              <p className="text-xs text-emerald-100 font-medium">
                Injection dans la file d'attente automatisée avec Spintax et Bouclier Anti-Ban
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white rounded-lg cursor-pointer hover:bg-white/10 transition-colors"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {successResult ? (
          <div className="p-8 text-center space-y-4 bg-slate-900">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-950/60">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-lg font-bold text-white">
                {successResult.created} messages injectés avec succès !
              </h4>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
                Les jobs ont été placés dans la file d'attente automatisée SQLite. Le worker autonome les traitera en tâche de fond avec la simulation de frappe humaine et les délais anti-ban.
              </p>
            </div>

            <div className="pt-4 flex items-center justify-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer border border-slate-700"
              >
                Fermer
              </button>
              {onNavigateToSender && (
                <button
                  onClick={() => {
                    onClose();
                    onNavigateToSender();
                  }}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/50 flex items-center gap-2 cursor-pointer transition-all border border-emerald-400"
                >
                  <span>Ouvrir WhatsApp Business Sender</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleTransfer} className="p-6 space-y-4">
            {errorMessage && (
              <div className="p-3.5 bg-rose-950/70 border border-rose-800 rounded-xl text-xs text-rose-200 font-medium flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Info Badge */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Source : <strong>{sourceModuleName}</strong></span>
              </div>
              <span className="font-bold font-mono px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg">
                {validContacts.length} contacts qualifiés
              </span>
            </div>

            {/* Preset Selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center space-x-1.5">
                <Briefcase className="w-3.5 h-3.5 text-purple-400" />
                <span>Modèle de Campagne DigiWare :</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DIGIWARE_TEMPLATES.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p.id)}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                      selectedPresetId === p.id
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200 font-semibold shadow-inner'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <div className="truncate">{p.title}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Message Template with Variables */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Contenu du Message (avec Spintax & Variables) :</span>
                </label>
                <span className="text-[10px] text-slate-400 font-mono">
                  {'{nom}'} • {'{entreprise}'} • {'{ville}'} • {'{...|...}'}
                </span>
              </div>
              <textarea
                value={messageTemplate}
                onChange={e => setMessageTemplate(e.target.value)}
                rows={6}
                className="w-full p-3.5 text-xs bg-slate-950 border border-slate-800 rounded-xl focus:border-emerald-500 text-slate-100 leading-relaxed font-mono focus:outline-none"
                required
              />
            </div>

            {/* Technical Notice */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 flex items-start gap-2.5 text-[11px] text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong>Exécution Autonome</strong> : Dès l'injection, les messages sont envoyés automatiquement en tâche de fond avec délais aléatoires, simulation de frappe et variations uniques sans risque de blocage.
              </span>
            </div>

            {/* Submit */}
            <div className="pt-2 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer border border-slate-700"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isSubmitting || validContacts.length === 0}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/50 flex items-center gap-2 cursor-pointer disabled:opacity-50 border border-emerald-400"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Transfert en cours...' : `Lancer les ${validContacts.length} envois`}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
