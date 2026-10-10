/**
 * Investigative Lead Detail Drawer
 * STE DigiWare SUARL - Lead Intelligence Architecture
 */
import React, { useState } from 'react';
import { 
  X, Phone, Mail, Globe, MapPin, Building2, 
  Briefcase, CheckCircle2, ShieldAlert, Sparkles, 
  ExternalLink, Calendar, Trash2, RefreshCw, Copy, Check,
  Search, ShieldCheck, HelpCircle, ArrowRight, ListTree,
  FileText, History, Clock, Layers
} from 'lucide-react';
import { LeadRecord, CandidateEmail, PriorityQueryItem } from '../../types/lead';

interface LeadDetailDrawerProps {
  lead: LeadRecord | null;
  onClose: () => void;
  onReEnrich: (leadId: string) => void;
  onDelete: (leadId: string) => void;
}

export const LeadDetailDrawer: React.FC<LeadDetailDrawerProps> = ({
  lead,
  onClose,
  onReEnrich,
  onDelete
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'emails' | 'discovery' | 'logs' | 'sources'>('overview');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!lead) return null;

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'EMAIL_CONFIRMED':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">✓ EMAIL CONFIRMÉ</span>;
      case 'EMAIL_FOUND':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">EMAIL TROUVÉ</span>;
      case 'EMAIL_CANDIDATE':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">EMAIL CANDIDAT</span>;
      case 'IDENTITY_FOUND':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-cyan-100 text-cyan-800 border border-cyan-300">IDENTITÉ TROUVÉE</span>;
      case 'DISCOVERY_IN_PROGRESS':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-300">ENQUÊTE EN COURS</span>;
      case 'NO_RESULT':
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">SANS SIGNAL</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-300">{status}</span>;
    }
  };

  const getEmailTypeLabel = (type: string | null) => {
    switch (type) {
      case 'company_domain': return 'Domaine Officiel Entreprise';
      case 'personal_public': return 'Webmail Pro (Gmail / Outlook)';
      case 'generic_org': return 'Boîte Générique (Contact / Info)';
      case 'isp_legacy': return 'Fournisseur Historique (Topnet/Gnet)';
      default: return 'Standard';
    }
  };

  const latinIdentity = lead.identities?.find(i => !/[\u0600-\u06FF]/.test(i.fullName))?.fullName ||
    (lead.firstName && lead.lastName && !/[\u0600-\u06FF]/.test(lead.firstName) ? `${lead.firstName} ${lead.lastName}` : null);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        
        {/* Drawer Header */}
        <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-mono font-bold text-xs">
              {lead.id.slice(-4)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base text-white">
                  {lead.title ? `${lead.title} ` : ''}{lead.fullName || lead.companyName || 'Prospect Tunisien'}
                </h3>
                {latinIdentity && latinIdentity !== lead.fullName && (
                  <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 font-medium">
                    FR: {latinIdentity}
                  </span>
                )}
                {getStatusBadge(lead.status)}
              </div>
              <p className="text-xs text-slate-400 font-mono">{lead.id} • {lead.nationalPhone} ({lead.operator})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-5 border-b border-slate-200 bg-slate-50 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 px-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'overview' ? 'border-indigo-600 text-indigo-600 font-bold bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Vue d'Ensemble
          </button>

          <button
            onClick={() => setActiveTab('emails')}
            className={`py-3 px-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'emails' ? 'border-indigo-600 text-indigo-600 font-bold bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            Emails & Candidats ({lead.candidateEmails?.length || (lead.email ? 1 : 0)})
          </button>

          <button
            onClick={() => setActiveTab('discovery')}
            className={`py-3 px-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'discovery' ? 'border-indigo-600 text-indigo-600 font-bold bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            Graph of Discovery ({lead.discoveries?.length || 0})
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`py-3 px-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'logs' ? 'border-indigo-600 text-indigo-600 font-bold bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            Journal de Recherche ({lead.searches?.length || 0})
          </button>

          <button
            onClick={() => setActiveTab('sources')}
            className={`py-3 px-3 border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeTab === 'sources' ? 'border-indigo-600 text-indigo-600 font-bold bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Sources ({lead.sources?.length || 0})
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-slate-700">
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Dual Confidence Gauges */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl shadow-sm">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-indigo-200">
                    <span>Confiance Email</span>
                    <span className="font-mono font-bold text-sm text-emerald-400">{lead.emailConfidence || 0}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        (lead.emailConfidence || 0) >= 80 ? 'bg-emerald-400' :
                        (lead.emailConfidence || 0) >= 50 ? 'bg-blue-400' : 'bg-amber-400'
                      }`}
                      style={{ width: `${lead.emailConfidence || 0}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 block">
                    {(lead.emailConfidence || 0) >= 80 ? 'Preuve directe confirmée' : 'Email à valider ou en attente'}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-indigo-200">
                    <span>Confiance Identité</span>
                    <span className="font-mono font-bold text-sm text-cyan-400">{lead.identityConfidence || 0}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${
                        (lead.identityConfidence || 0) >= 80 ? 'bg-cyan-400' :
                        (lead.identityConfidence || 0) >= 50 ? 'bg-blue-400' : 'bg-amber-400'
                      }`}
                      style={{ width: `${lead.identityConfidence || 0}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 block">
                    {lead.fullName ? `Lié à ${lead.fullName}` : 'Numéro seul identifié'}
                  </span>
                </div>
              </div>

              {/* Verified Contact Card */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Coordonnées Vérifiées</span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded">
                    Secteur: {lead.primarySector}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {/* Phone */}
                  <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <Phone className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-400 block">Téléphone National (+216)</span>
                        <span className="font-mono font-bold text-slate-900 text-sm">{lead.nationalPhone}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(lead.normalizedPhone, 'phone')}
                      className="p-1.5 hover:bg-slate-100 text-slate-500 rounded cursor-pointer"
                      title="Copier"
                    >
                      {copiedField === 'phone' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Email */}
                  <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        lead.email ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'
                      }`}>
                        <Mail className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-400 block">
                          Email Professionnel {lead.emailType ? `(${getEmailTypeLabel(lead.emailType)})` : ''}
                        </span>
                        <span className={`font-mono font-bold text-sm ${lead.email ? 'text-indigo-600' : 'text-slate-400 italic'}`}>
                          {lead.email || 'Aucun email public trouvé'}
                        </span>
                      </div>
                    </div>
                    {lead.email && (
                      <button
                        onClick={() => copyToClipboard(lead.email!, 'email')}
                        className="p-1.5 hover:bg-slate-100 text-slate-500 rounded cursor-pointer"
                        title="Copier"
                      >
                        {copiedField === 'email' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    )}
                  </div>

                  {/* Website */}
                  {lead.website && (
                    <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                          <Globe className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[11px] text-slate-400 block">Site Web Officiel</span>
                          <span className="font-mono text-slate-900 text-xs">{lead.website}</span>
                        </div>
                      </div>
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 hover:bg-slate-100 text-blue-600 rounded cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Entity Context Table */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block border-b border-slate-200 pb-2">
                  Détails de l'Entité Commerciale
                </span>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px] block">Société / Cabinet</span>
                    <span className="font-bold text-slate-900">{lead.companyName || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Profession</span>
                    <span className="font-bold text-slate-900">{lead.profession || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Opérateur Télécom</span>
                    <span className="font-bold text-slate-900">{lead.operator}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Ville / Région</span>
                    <span className="font-bold text-slate-900">
                      {[lead.city, lead.regionGovernorate].filter(Boolean).join(', ') || '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Social & Digital Presence Card (Facebook, LinkedIn, Instagram) */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block border-b border-slate-200 pb-2">
                  Empreinte Réseaux Sociaux & Numérique
                </span>
                <div className="grid grid-cols-3 gap-2.5 text-xs">
                  {/* Facebook */}
                  {lead.digitalAssets?.find(a => a.type === 'facebook') ? (
                    <a
                      href={lead.digitalAssets.find(a => a.type === 'facebook')?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-blue-700 hover:bg-blue-100 transition-colors"
                      title="Page Facebook découverte"
                    >
                      <span className="font-bold text-xs flex items-center gap-1.5 truncate">
                        <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" /> Facebook
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  ) : (
                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-400 flex items-center justify-between">
                      <span className="text-xs">Facebook</span>
                      <span className="text-[10px] italic">Non indexé</span>
                    </div>
                  )}

                  {/* LinkedIn */}
                  {lead.digitalAssets?.find(a => a.type === 'linkedin') ? (
                    <a
                      href={lead.digitalAssets.find(a => a.type === 'linkedin')?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2.5 bg-sky-50 border border-sky-200 rounded-lg flex items-center justify-between text-sky-700 hover:bg-sky-100 transition-colors"
                      title="Profil LinkedIn découvert"
                    >
                      <span className="font-bold text-xs flex items-center gap-1.5 truncate">
                        <span className="w-2 h-2 rounded-full bg-sky-600 shrink-0" /> LinkedIn
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  ) : (
                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-400 flex items-center justify-between">
                      <span className="text-xs">LinkedIn</span>
                      <span className="text-[10px] italic">Non indexé</span>
                    </div>
                  )}

                  {/* Instagram */}
                  {lead.digitalAssets?.find(a => a.type === 'instagram') ? (
                    <a
                      href={lead.digitalAssets.find(a => a.type === 'instagram')?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2.5 bg-pink-50 border border-pink-200 rounded-lg flex items-center justify-between text-pink-700 hover:bg-pink-100 transition-colors"
                      title="Compte Instagram découvert"
                    >
                      <span className="font-bold text-xs flex items-center gap-1.5 truncate">
                        <span className="w-2 h-2 rounded-full bg-pink-600 shrink-0" /> Instagram
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  ) : (
                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-slate-400 flex items-center justify-between">
                      <span className="text-xs">Instagram</span>
                      <span className="text-[10px] italic">Non indexé</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CANDIDATE EMAILS */}
          {activeTab === 'emails' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Adresses Emails Découvertes ({lead.candidateEmails?.length || 0})
                </h4>
                <span className="text-[11px] text-slate-400">Classées par score de preuve</span>
              </div>

              {(!lead.candidateEmails || lead.candidateEmails.length === 0) ? (
                <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200 p-6">
                  <Mail className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 font-medium">Aucun email candidat trouvé pour ce prospect.</p>
                  <p className="text-[11px] text-slate-400 mt-1">Le moteur n'a inventé aucune donnée conformément à la règle stricte.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {lead.candidateEmails.map((cand, idx) => (
                    <div 
                      key={idx} 
                      className={`p-3.5 rounded-xl border transition-all ${
                        cand.score >= 85 ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono font-bold text-slate-900 text-sm">{cand.email}</span>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            cand.score >= 85 ? 'bg-emerald-100 text-emerald-800' :
                            cand.score >= 60 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            Score: {cand.score}%
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 font-medium">
                            {cand.verificationStatus}
                          </span>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-500 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-700">Type :</span>
                          <span>{getEmailTypeLabel(cand.emailType)}</span>
                          <span className="text-slate-300">•</span>
                          <span className="font-semibold text-slate-700">Corroborations :</span>
                          <span>{cand.corroborationCount || 1} source(s)</span>
                        </div>
                        {cand.reason && (
                          <p className="text-slate-600 italic bg-white/80 p-1.5 rounded border border-slate-100">
                            {cand.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: GRAPH OF DISCOVERY */}
          {activeTab === 'discovery' && (
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Chaîne d'Indices & Entités Découvertes ({lead.discoveries?.length || 0})
              </h4>

              {(!lead.discoveries || lead.discoveries.length === 0) ? (
                <p className="text-xs text-slate-400 italic">Aucune entité intermédiaire enregistrée.</p>
              ) : (
                <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-indigo-100">
                  {lead.discoveries.map((disc, idx) => (
                    <div key={disc.id || idx} className="relative group">
                      <div className="absolute -left-6 top-1.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-600 flex items-center justify-center" />
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                            {disc.type}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {disc.timestamp ? new Date(disc.timestamp).toLocaleTimeString() : ''}
                          </span>
                        </div>
                        <div className="font-bold text-slate-900 text-xs">{disc.value}</div>
                        {disc.snippet && (
                          <p className="text-[11px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-100">
                            "{disc.snippet.slice(0, 140)}..."
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: LOGS & QUERIES */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              {/* Executed Searches */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Requêtes Exécutées ({lead.searches?.length || 0})
                </h4>
                {lead.searches && lead.searches.length > 0 ? (
                  <div className="space-y-2">
                    {lead.searches.map((s, idx) => (
                      <div key={s.id || idx} className="p-3 bg-slate-900 text-white rounded-lg space-y-1 font-mono text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-indigo-400 font-bold">{s.query}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                            {s.resultsCount || 0} résultats
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-sans">{s.reason}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">Aucune requête exécutée pour l'instant.</p>
                )}
              </div>

              {/* Step-by-step Audit Logs */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Journal Chronologique d'Enquête
                </h4>
                <div className="p-3 bg-slate-950 text-slate-300 rounded-xl space-y-1.5 font-mono text-[11px] max-h-60 overflow-y-auto">
                  {lead.searchLogs && lead.searchLogs.length > 0 ? (
                    lead.searchLogs.map((log, idx) => (
                      <div key={log.id || idx} className="leading-relaxed">
                        <span className="text-slate-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                        <span className={`font-bold ${
                          log.type === 'SEARCH' ? 'text-indigo-400' :
                          log.type === 'DISCOVERY' ? 'text-emerald-400' :
                          log.type === 'STOP' ? 'text-amber-400' :
                          log.type === 'VERIFICATION' ? 'text-cyan-400' : 'text-slate-300'
                        }`}>
                          [{log.type}]
                        </span>{' '}
                        <span>{log.message}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-600 italic">Aucun log enregistré.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: SOURCES */}
          {activeTab === 'sources' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Sources Publiques Indexées ({lead.sources?.length || 0})
              </h4>
              {(!lead.sources || lead.sources.length === 0) ? (
                <p className="text-xs text-slate-400 italic">Aucune source externe enregistrée.</p>
              ) : (
                <div className="space-y-2">
                  {lead.sources.map((src, idx) => (
                    <div key={src.id || idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold text-indigo-700 uppercase">
                          {src.fieldName} : {src.fieldValue}
                        </span>
                        <span className="text-[10px] text-slate-400">{src.sourceType}</span>
                      </div>
                      <div className="text-xs text-slate-600 truncate font-mono">
                        {src.sourceUrl}
                      </div>
                      {src.snippet && (
                        <p className="text-[11px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-100 mt-1">
                          "{src.snippet}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={() => onDelete(lead.id)}
            className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Supprimer
          </button>

          <button
            onClick={() => onReEnrich(lead.id)}
            className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Relancer l'Enquête
          </button>
        </div>

      </div>
    </div>
  );
};
