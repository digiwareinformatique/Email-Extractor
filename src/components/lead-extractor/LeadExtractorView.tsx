import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, Upload, Download, Sparkles, RefreshCw, 
  Search, Filter, Mail, Globe, Phone, CheckCircle2, 
  AlertCircle, ShieldAlert, Play, Pause, RotateCcw, 
  Eye, Trash2, Layers, ExternalLink, ChevronLeft, 
  ChevronRight, Building2, MapPin, Check, Copy, Tag, MessageCircle, Cpu, Send
} from 'lucide-react';
import { 
  LeadRecord, 
  DashboardMetrics, 
  LeadFilterOptions, 
  EnrichmentJobState, 
  SegmentDefinition 
} from '../../types/lead';
import { leadApi } from '../../services/leadApi';
import { LeadDashboard } from './LeadDashboard';
import { LeadImporter } from './LeadImporter';
import { LeadDetailDrawer } from './LeadDetailDrawer';
import { ExportModal } from './ExportModal';
import { SegmentManagerModal } from './SegmentManagerModal';
import { AiConfigModal } from '../AiConfigModal';

interface LeadExtractorViewProps {
  onTransferToSender?: (contacts: { phone: string; name?: string; id?: string; company?: string }[]) => void;
}

export const LeadExtractorView: React.FC<LeadExtractorViewProps> = ({
  onTransferToSender
}) => {
  // Data States
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [totalLeads, setTotalLeads] = useState<number>(0);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [segments, setSegments] = useState<SegmentDefinition[]>([]);
  const [jobState, setJobState] = useState<EnrichmentJobState | null>(null);
  const [isAiConfigOpen, setIsAiConfigOpen] = useState<boolean>(false);

  // UI States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null);
  const [isImporterOpen, setIsImporterOpen] = useState<boolean>(false);
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isSegmentsOpen, setIsSegmentsOpen] = useState<boolean>(false);
  const [isReanalyzeModalOpen, setIsReanalyzeModalOpen] = useState<boolean>(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [reanalyzingSingleId, setReanalyzingSingleId] = useState<string | null>(null);

  // Filters State
  const [filters, setFilters] = useState<LeadFilterOptions>({
    search: '',
    emailFilter: 'all',
    websiteFilter: 'all',
    sector: 'all',
    confidenceLevel: 'all',
    status: 'all',
    page: 1,
    limit: 25,
    sortBy: 'updatedAt',
    sortOrder: 'desc'
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initial Load
  useEffect(() => {
    loadAllData();
    loadSegments();

    // Start polling job status
    pollIntervalRef.current = setInterval(checkJobStatus, 2000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Reload leads when filters change
  useEffect(() => {
    loadLeads();
  }, [filters]);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [leadsRes, metricsRes, jobRes] = await Promise.all([
        leadApi.getLeads(filters),
        leadApi.getDashboardMetrics(),
        leadApi.getJobStatus()
      ]);
      setLeads(leadsRes.leads);
      setTotalLeads(leadsRes.total);
      setMetrics(metricsRes);
      setJobState(jobRes);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLeads = async () => {
    try {
      const res = await leadApi.getLeads(filters);
      setLeads(res.leads);
      setTotalLeads(res.total);
    } catch (err) {
      console.error('Error loading leads:', err);
    }
  };

  const loadSegments = async () => {
    try {
      const res = await leadApi.getSegments();
      setSegments(res);
    } catch (err) {
      console.error('Error loading segments:', err);
    }
  };

  const checkJobStatus = async () => {
    try {
      const status = await leadApi.getJobStatus();
      setJobState(status);
      if (status.status === 'RUNNING') {
        const [leadsRes, metricsRes] = await Promise.all([
          leadApi.getLeads(filters),
          leadApi.getDashboardMetrics()
        ]);
        setLeads(leadsRes.leads);
        setTotalLeads(leadsRes.total);
        setMetrics(metricsRes);
      }
    } catch (err) {
      // Ignore poll errors
    }
  };

  // Job Actions
  const handleStartJob = async (scope: 'pending' | 'all' | 'without_email' | 'no_result' | 'selected' = 'pending') => {
    try {
      const ids: string[] | undefined = scope === 'selected' ? Array.from(selectedLeadIds) : undefined;
      const updated = await leadApi.startJob({
        targetScope: scope,
        leadIds: ids,
        forceReinvestigate: scope !== 'pending'
      });
      setJobState(updated);
      setIsReanalyzeModalOpen(false);
      setSelectedLeadIds(new Set());
      loadAllData();
    } catch (err) {
      console.error('Error starting job:', err);
    }
  };

  const handlePauseJob = async () => {
    const updated = await leadApi.pauseJob();
    setJobState(updated);
  };

  const handleResumeJob = async () => {
    const updated = await leadApi.resumeJob();
    setJobState(updated);
  };

  const handleResetJob = async () => {
    const updated = await leadApi.resetJob();
    setJobState(updated);
  };

  const handleReEnrichLead = async (leadId: string, metier?: string) => {
    try {
      setReanalyzingSingleId(leadId);
      const leadObj = leads.find(l => l.id === leadId) || (selectedLead?.id === leadId ? selectedLead : null);
      const targetMetier = metier || leadObj?.targetMetier || (leadObj?.primarySector && leadObj.primarySector !== 'INCONNU' ? leadObj.primarySector : undefined);
      const updated = await leadApi.enrichSingleLead(leadId, { forceReinvestigate: true, targetMetier });
      if (selectedLead && selectedLead.id === leadId) {
        setSelectedLead(updated);
      }
      loadAllData();
    } catch (err) {
      console.error('Re-enrich error:', err);
    } finally {
      setReanalyzingSingleId(null);
    }
  };

  const toggleSelectLead = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedLeadIds(new Set(leads.map(l => l.id)));
    } else {
      setSelectedLeadIds(new Set());
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!window.confirm('Voulez-vous vraiment supprimer ce lead ?')) return;
    try {
      await leadApi.deleteLead(leadId);
      setSelectedLead(null);
      loadAllData();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Attention : Cette action effacera TOUTE la base locale des leads. Êtes-vous certain ?')) return;
    try {
      await leadApi.clearAllLeads();
      loadAllData();
    } catch (err) {
      console.error('Clear all error:', err);
    }
  };

  // Status Badge Helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'EMAIL_CONFIRMED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">✓ EMAIL CONFIRMÉ</span>;
      case 'EMAIL_FOUND':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">EMAIL TROUVÉ</span>;
      case 'EMAIL_CANDIDATE':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">EMAIL CANDIDAT</span>;
      case 'IDENTITY_FOUND':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-100 text-cyan-800 border border-cyan-200">IDENTITÉ TROUVÉE</span>;
      case 'DISCOVERY_IN_PROGRESS':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            <span>ENQUÊTE</span>
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            <span>EN COURS</span>
          </span>
        );
      case 'ENRICHED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">ENRICHI</span>;
      case 'PENDING':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">EN ATTENTE</span>;
      case 'NO_RESULT':
      case 'NOT_FOUND':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">SANS SIGNAL</span>;
      case 'AMBIGUOUS':
      case 'NEEDS_VERIFICATION':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">À VÉRIFIER</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">{status}</span>;
    }
  };

  const totalPages = Math.ceil(totalLeads / (filters.limit || 25)) || 1;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* 1. TOP HEADER & PROSPECTION CONTROLS */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold font-mono text-sm shadow-xs">
                DW
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900">DIGIWARE LEAD EXTRACTOR</h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
                    Moteur B2B Tunisie
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Philosophie : PHONE → IDENTITY → DISCOVERY → EMAIL • Arrêt immédiat dès découverte vérifiée
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setIsAiConfigOpen(true)}
              className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Configurer l'IA (Gemini, Groq, DeepSeek, OpenAI, Local, 0 Quota)"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-600" />
              <span>Moteur IA & Quota</span>
            </button>

            <button
              onClick={() => setIsSegmentsOpen(true)}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Secteurs & Packs</span>
            </button>

            <button
              onClick={() => setIsImporterOpen(true)}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importer Numéros (+216)</span>
            </button>

            <button
              onClick={() => setIsReanalyzeModalOpen(true)}
              disabled={metrics?.totalLeads === 0}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              title="Relancer l'analyse et l'enquête adaptative sur les leads"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Ré-analyser les Leads</span>
            </button>

            <button
              onClick={() => setIsExportOpen(true)}
              disabled={leads.length === 0}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exporter CSV</span>
            </button>

            {onTransferToSender && (
              <button
                onClick={() => {
                  const targets = selectedLeadIds.size > 0 
                    ? leads.filter(l => selectedLeadIds.has(l.id)).map(l => ({ phone: l.normalizedPhone || l.rawPhone, name: l.fullName || undefined, id: l.id, company: l.companyName || undefined }))
                    : leads.map(l => ({ phone: l.normalizedPhone || l.rawPhone, name: l.fullName || undefined, id: l.id, company: l.companyName || undefined }));
                  onTransferToSender(targets);
                }}
                disabled={leads.length === 0}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                title="Transférer vers WhatsApp Sender pour envoi via WhatsApp Web"
              >
                <Send className="w-3.5 h-3.5 text-emerald-400" />
                <span>Envoyer via Sender {selectedLeadIds.size > 0 ? `(${selectedLeadIds.size})` : ''}</span>
              </button>
            )}

            <button
              onClick={handleClearAll}
              disabled={leads.length === 0}
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              title="Vider la base locale"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ASYNCHRONOUS JOB QUEUE RUNNER BAR */}
        {jobState && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 p-3.5 rounded-xl border">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${jobState.status === 'RUNNING' ? 'bg-indigo-100 text-indigo-700 animate-pulse' : 'bg-slate-200 text-slate-600'}`}>
                <RefreshCw className={`w-4 h-4 ${jobState.status === 'RUNNING' ? 'animate-spin' : ''}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    File d'Enquête Adaptative :
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    jobState.status === 'RUNNING' ? 'bg-emerald-100 text-emerald-800' :
                    jobState.status === 'PAUSED' ? 'bg-amber-100 text-amber-800' :
                    jobState.status === 'COMPLETED' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {jobState.status}
                  </span>
                  {jobState.speedLeadsPerMin ? (
                    <span className="text-[10px] text-slate-500 font-mono">
                      ({jobState.speedLeadsPerMin} leads/min)
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span>Progression : <strong className="text-slate-800">{jobState.processedLeads}</strong> / {jobState.totalLeads} traités</span>
                  <span className="text-slate-400">•</span>
                  <span>({jobState.emailConfirmedCount || 0} confirmés, {jobState.emailFoundCount || 0} trouvés, {jobState.identityFoundCount || 0} identités)</span>
                  {jobState.currentLeadPhone && (
                    <span className="font-mono bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-indigo-100">
                      Numéro en cours : {jobState.currentLeadPhone}
                    </span>
                  )}
                  {jobState.currentQueryText && (
                    <span className="text-slate-400 truncate max-w-xs text-[10px] italic">
                      ({jobState.currentQueryText})
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {jobState.status === 'RUNNING' ? (
                <button
                  onClick={handlePauseJob}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              ) : jobState.status === 'PAUSED' ? (
                <button
                  onClick={handleResumeJob}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Reprendre</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleStartJob('pending')}
                    disabled={metrics?.totalLeads === 0}
                    className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Lancer Nouveaux Leads</span>
                  </button>
                  <button
                    onClick={() => setIsReanalyzeModalOpen(true)}
                    disabled={metrics?.totalLeads === 0}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    title="Options de ré-analyse"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Options Ré-analyse</span>
                  </button>
                </div>
              )}

              <button
                onClick={handleResetJob}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                title="Réinitialiser l'état de la file"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* BATCH SELECTION ACTION BAR */}
      {selectedLeadIds.size > 0 && (
        <div className="bg-indigo-900 text-white p-3.5 rounded-xl shadow-md flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full bg-indigo-700 text-white text-xs font-bold flex items-center justify-center">
              {selectedLeadIds.size}
            </span>
            <span className="text-xs font-medium">
              <strong className="font-bold">{selectedLeadIds.size}</strong> lead(s) sélectionné(s)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleStartJob('selected')}
              className="px-3 py-1.5 bg-white text-indigo-950 hover:bg-indigo-50 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
              <span>Ré-analyser la sélection ({selectedLeadIds.size})</span>
            </button>
            <button
              onClick={() => setSelectedLeadIds(new Set())}
              className="px-2.5 py-1.5 text-indigo-200 hover:text-white text-xs transition-colors cursor-pointer"
            >
              Désélectionner
            </button>
          </div>
        </div>
      )}

      {/* 2. METRICS DASHBOARD */}
      <LeadDashboard metrics={metrics} isLoading={isLoading} />

      {/* 3. FILTERS & SEARCH BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filters.search || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value, page: 1 }))}
              placeholder="Rechercher par nom, société, téléphone (+216), email, profession ou ville..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          {/* Quick Segment Filter */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <select
              value={filters.sector || 'all'}
              onChange={(e) => setFilters(prev => ({ ...prev, sector: e.target.value, page: 1 }))}
              className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">Tous les Secteurs</option>
              {segments.map(s => (
                <option key={s.id} value={s.code}>{s.label}</option>
              ))}
            </select>

            {/* Email Filter */}
            <select
              value={filters.emailFilter || 'all'}
              onChange={(e) => setFilters(prev => ({ ...prev, emailFilter: e.target.value as any, page: 1 }))}
              className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">Email : Tous</option>
              <option value="with_email">Avec Email (Tous)</option>
              <option value="confirmed_email">Email Confirmé (✓)</option>
              <option value="candidate_email">Email Candidat</option>
              <option value="without_email">Sans Email</option>
            </select>

            {/* Confidence Filter */}
            <select
              value={filters.confidenceLevel || 'all'}
              onChange={(e) => setFilters(prev => ({ ...prev, confidenceLevel: e.target.value as any, page: 1 }))}
              className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
            >
              <option value="all">Confiance : Toutes</option>
              <option value="HIGH">Confiance Élevée (80%+)</option>
              <option value="MEDIUM">Confiance Moyenne</option>
              <option value="LOW">Confiance Faible</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. LEADS DATA TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800">
              Résultats de Prospection ({totalLeads.toLocaleString('fr-FR')} leads)
            </span>
          </div>
          <span className="text-xs text-slate-500">
            Page {filters.page || 1} sur {totalPages}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={leads.length > 0 && selectedLeadIds.size === leads.length}
                    onChange={toggleSelectAllPage}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Lead ID</th>
                <th className="py-3 px-4">Téléphone (+216)</th>
                <th className="py-3 px-4">Nom / Identité</th>
                <th className="py-3 px-4">Société & Profession</th>
                <th className="py-3 px-4">Secteur</th>
                <th className="py-3 px-4">Ville</th>
                <th className="py-3 px-4">Email Pro & Score</th>
                <th className="py-3 px-4">Site Web</th>
                <th className="py-3 px-4">Score Identité</th>
                <th className="py-3 px-4">Statut</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.length > 0 ? (
                leads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`hover:bg-slate-50/80 transition-colors cursor-pointer group ${
                      selectedLeadIds.has(lead.id) ? 'bg-indigo-50/40' : ''
                    }`}
                  >
                    {/* Select Checkbox */}
                    <td className="py-3 px-3 text-center" onClick={(e) => toggleSelectLead(lead.id, e)}>
                      <input
                        type="checkbox"
                        checked={selectedLeadIds.has(lead.id)}
                        onChange={() => {}}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </td>

                    {/* Lead ID */}
                    <td className="py-3 px-4 font-mono font-bold text-slate-700">
                      {lead.id}
                    </td>

                    {/* Phone */}
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-slate-900">{lead.nationalPhone}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{lead.operator}</div>
                    </td>

                    {/* Name */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">
                        {lead.title ? `${lead.title} ` : ''}{lead.fullName || <span className="text-slate-400 italic font-normal">Inconnu</span>}
                      </div>
                      {(() => {
                        const isAr = /[\u0600-\u06FF]/.test(lead.fullName || '');
                        const latin = lead.identities?.find(i => !/[\u0600-\u06FF]/.test(i.fullName))?.fullName ||
                          (lead.firstName && lead.lastName && !/[\u0600-\u06FF]/.test(lead.firstName) ? `${lead.firstName} ${lead.lastName}` : null);
                        if (isAr && latin && latin !== lead.fullName) {
                          return (
                            <div className="text-[10px] text-indigo-600 font-medium flex items-center gap-1 mt-0.5">
                              <span className="px-1 py-0.2 bg-indigo-50 border border-indigo-200 rounded text-[9px] font-bold">FR</span>
                              <span>{latin}</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </td>

                    {/* Company & Profession */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800">{lead.companyName || '—'}</div>
                      {lead.profession && (
                        <div className="text-[11px] text-slate-500">{lead.profession}</div>
                      )}
                    </td>

                    {/* Sector */}
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-mono text-[10px] font-bold rounded">
                        {lead.primarySector}
                      </span>
                    </td>

                    {/* City */}
                    <td className="py-3 px-4 text-slate-700">
                      {lead.city || '—'}
                    </td>

                    {/* Email */}
                    <td className="py-3 px-4 font-mono">
                      {lead.email ? (
                        <div>
                          <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
                            <Mail className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[150px]">{lead.email}</span>
                          </div>
                          <div className="text-[10px] text-emerald-600 font-sans font-medium">
                            Score : {lead.emailConfidence}%
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-300 italic font-sans">NULL</span>
                      )}
                    </td>

                    {/* Website & Social Presence */}
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        {lead.website ? (
                          <a
                            href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:underline flex items-center gap-1 font-mono text-[11px]"
                          >
                            <Globe className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-[100px]">{lead.website.replace(/^https?:\/\//, '')}</span>
                          </a>
                        ) : null}

                        {/* Social Badges: FB, LI, IG */}
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {lead.digitalAssets?.find(a => a.type === 'facebook') && (
                            <a
                              href={lead.digitalAssets.find(a => a.type === 'facebook')?.url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-1 py-0.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-800 text-[9px] font-bold"
                              title="Page Facebook découverte"
                            >
                              FB
                            </a>
                          )}
                          {lead.digitalAssets?.find(a => a.type === 'linkedin') && (
                            <a
                              href={lead.digitalAssets.find(a => a.type === 'linkedin')?.url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-1 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-800 text-[9px] font-bold"
                              title="Profil LinkedIn découvert"
                            >
                              IN
                            </a>
                          )}
                          {lead.digitalAssets?.find(a => a.type === 'instagram') && (
                            <a
                              href={lead.digitalAssets.find(a => a.type === 'instagram')?.url}
                              target="_blank"
                              rel="noreferrer"
                              className="px-1 py-0.5 rounded bg-pink-100 hover:bg-pink-200 text-pink-800 text-[9px] font-bold"
                              title="Compte Instagram découvert"
                            >
                              IG
                            </a>
                          )}
                          {!lead.website && (!lead.digitalAssets || lead.digitalAssets.length === 0) && (
                            <span className="text-slate-300">—</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Identity Score */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className="bg-cyan-500 h-full rounded-full" 
                            style={{ width: `${lead.identityConfidence || 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {lead.identityConfidence || 0}%
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      {getStatusBadge(lead.status)}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleReEnrichLead(lead.id)}
                          disabled={reanalyzingSingleId === lead.id}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                          title="Ré-analyser ce lead (Relancer l'enquête)"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${reanalyzingSingleId === lead.id ? 'animate-spin text-indigo-700' : ''}`} />
                        </button>

                        <a
                          href={`https://wa.me/216${lead.rawPhone.replace(/\D/g, '').slice(-8)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Contacter sur WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>

                        {onTransferToSender && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onTransferToSender([{
                                phone: lead.normalizedPhone || lead.rawPhone,
                                name: lead.fullName || undefined,
                                id: lead.id,
                                company: lead.companyName || undefined
                              }]);
                            }}
                            className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            title="Transférer ce lead vers WhatsApp Sender"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedLead(lead)}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                          title="Voir la fiche détaillée & sources"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-400">
                    <Users className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">Aucun lead ne correspond aux critères.</p>
                    <p className="text-xs text-slate-400 mt-1">Importez une liste de numéros tunisiens pour commencer.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Affichage {((filters.page || 1) - 1) * (filters.limit || 25) + 1} à{' '}
              {Math.min((filters.page || 1) * (filters.limit || 25), totalLeads)} sur {totalLeads} leads
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilters(prev => ({ ...prev, page: Math.max(1, (prev.page || 1) - 1) }))}
                disabled={(filters.page || 1) <= 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold px-3 py-1 bg-white border border-slate-200 rounded-lg font-mono">
                {filters.page || 1} / {totalPages}
              </span>
              <button
                onClick={() => setFilters(prev => ({ ...prev, page: Math.min(totalPages, (prev.page || 1) + 1) }))}
                disabled={(filters.page || 1) >= totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODALS & DRAWERS */}
      <LeadImporter
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        onImportSuccess={() => {
          setIsImporterOpen(false);
          loadAllData();
        }}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        segments={segments}
        filterOptions={filters}
      />

      <SegmentManagerModal
        isOpen={isSegmentsOpen}
        onClose={() => setIsSegmentsOpen(false)}
        segments={segments}
        onSegmentCreated={loadSegments}
      />

      <LeadDetailDrawer
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onReEnrich={handleReEnrichLead}
        onDelete={handleDeleteLead}
      />

      {/* RE-ANALYZE OPTIONS MODAL */}
      {isReanalyzeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Options de Ré-analyse des Leads</h3>
                  <p className="text-xs text-slate-400">Relancez l'enquête adaptative pour découvrir de nouvelles données</p>
                </div>
              </div>
              <button
                onClick={() => setIsReanalyzeModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <ChevronRight className="w-5 h-5 rotate-90" />
              </button>
            </div>

            {/* Options List */}
            <div className="p-5 space-y-3">
              {/* Option 1: Re-analyze ALL leads */}
              <button
                onClick={() => handleStartJob('all')}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/40 transition-all group flex items-start gap-3.5 cursor-pointer"
              >
                <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl group-hover:scale-105 transition-transform mt-0.5">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 group-hover:text-indigo-900">
                      Tout Ré-analyser (100% de la base)
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                      {metrics?.totalLeads || 0} leads
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Réinitialise l'état et relance l'intégralité des requêtes pour tous les numéros importés, même ceux déjà analysés.
                  </p>
                </div>
              </button>

              {/* Option 2: Re-analyze without email */}
              <button
                onClick={() => handleStartJob('without_email')}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50/40 transition-all group flex items-start gap-3.5 cursor-pointer"
              >
                <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl group-hover:scale-105 transition-transform mt-0.5">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 group-hover:text-amber-900">
                      Ré-analyser les Leads SANS EMAIL
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">
                      {metrics?.withoutEmail || 0} leads
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Cible uniquement les prospects n'ayant pas encore d'email identifié pour creuser de nouvelles pistes publiques.
                  </p>
                </div>
              </button>

              {/* Option 3: Re-analyze NO_RESULT */}
              <button
                onClick={() => handleStartJob('no_result')}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-rose-500 hover:bg-rose-50/40 transition-all group flex items-start gap-3.5 cursor-pointer"
              >
                <div className="p-2.5 bg-rose-100 text-rose-700 rounded-xl group-hover:scale-105 transition-transform mt-0.5">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900 group-hover:text-rose-900">
                      Ré-analyser les SANS SIGNAL / NON TROUVÉS
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-100 text-rose-800 rounded-full">
                      {metrics?.notFound || 0} leads
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Retente une prospection approfondie pour les numéros n'ayant donné aucun signal lors du premier passage.
                  </p>
                </div>
              </button>

              {/* Option 4: Pending only */}
              <button
                onClick={() => handleStartJob('pending')}
                className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-all group flex items-start gap-3.5 cursor-pointer"
              >
                <div className="p-2.5 bg-slate-100 text-slate-700 rounded-xl group-hover:scale-105 transition-transform mt-0.5">
                  <Play className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-900">
                      Analyser uniquement les NOUVEAUX en attente
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Traite uniquement les numéros qui n'ont jamais été traités par le moteur.
                  </p>
                </div>
              </button>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setIsReanalyzeModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI PROVIDER CONFIG MODAL */}
      <AiConfigModal
        isOpen={isAiConfigOpen}
        onClose={() => setIsAiConfigOpen(false)}
      />
    </div>
  );
};
