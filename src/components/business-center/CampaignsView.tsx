import React, { useState, useEffect } from 'react';
import { 
  Layers, Play, Pause, Square, Plus, CheckCircle, Clock, AlertCircle, 
  RefreshCw, BarChart2, Eye, Filter, ArrowRight, Sparkles, Send, ShieldCheck,
  ListFilter, Users, Trash2, ExternalLink, CheckCircle2, MessageSquare
} from 'lucide-react';
import { MultiSegmentCampaign, MessageTemplate, CrmList } from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

interface CampaignsViewProps {
  initialTargetListId?: string;
  onNavigateToCrm?: (listId?: string) => void;
}

export const CampaignsView: React.FC<CampaignsViewProps> = ({
  initialTargetListId,
  onNavigateToCrm
}) => {
  const [campaigns, setCampaigns] = useState<MultiSegmentCampaign[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [crmLists, setCrmLists] = useState<CrmList[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<MultiSegmentCampaign | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // New Campaign Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [audienceType, setAudienceType] = useState<'LIST' | 'MULTI_SEGMENTS'>('LIST');
  const [targetListId, setTargetListId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newDailyGoal, setNewDailyGoal] = useState<number>(10);
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (initialTargetListId) {
      setAudienceType('LIST');
      setTargetListId(initialTargetListId);
      setIsModalOpen(true);
    }
  }, [initialTargetListId]);

  const loadData = async () => {
    try {
      const [cList, tList, lList] = await Promise.all([
        businessCenterApi.getCampaigns(),
        businessCenterApi.getTemplates(),
        businessCenterApi.getCrmLists()
      ]);
      setCampaigns(cList);
      setTemplates(tList);
      setCrmLists(lList);

      if (lList.length > 0 && !targetListId) {
        setTargetListId(lList[0].id);
        setNewDailyGoal(lList[0].contact_count || 10);
      }
      if (tList.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(tList[0].id);
      }

      if (cList.length > 0 && !selectedCampaign) {
        setSelectedCampaign(cList[0]);
      } else if (cList.length > 0 && selectedCampaign) {
        const updated = cList.find(c => c.id === selectedCampaign.id);
        if (updated) setSelectedCampaign(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePrepare = async (campId: string) => {
    setIsProcessing(true);
    setActionFeedback(null);
    try {
      const res = await businessCenterApi.prepareCampaign(campId);
      setActionFeedback(`✓ ${res.totalPrepared} jobs préparés et vérifiés selon l'audience ciblée.`);
      await loadData();
    } catch (err: any) {
      setActionFeedback(`Erreur : ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLaunch = async (campId: string) => {
    setIsProcessing(true);
    setActionFeedback(null);
    try {
      const res = await businessCenterApi.launchCampaign(campId);
      setActionFeedback(`🚀 Campagne active : ${res.dispatched} messages WhatsApp transmis avec succès au Sender.`);
      await loadData();
    } catch (err: any) {
      setActionFeedback(`Erreur : ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePause = async (campId: string) => {
    try {
      await businessCenterApi.pauseCampaign(campId);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleResume = async (campId: string) => {
    try {
      await businessCenterApi.resumeCampaign(campId);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCampaign = async (campId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Confirmer la suppression de cette campagne ?')) return;
    try {
      await businessCenterApi.deleteCampaign(campId);
      if (selectedCampaign?.id === campId) {
        setSelectedCampaign(null);
      }
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenCreateModal = () => {
    if (crmLists.length > 0) {
      setAudienceType('LIST');
      setTargetListId(crmLists[0].id);
      setNewDailyGoal(crmLists[0].contact_count || 10);
      setNewCampaignName(`Campagne WhatsApp - ${crmLists[0].name}`);
    } else {
      setAudienceType('MULTI_SEGMENTS');
      setNewDailyGoal(50);
      setNewCampaignName('Prospection Multi-Segments DigiWare');
    }
    if (templates.length > 0) {
      setSelectedTemplateId(templates[0].id);
    }
    setNewDescription('Campagne WhatsApp ciblée');
    setIsModalOpen(true);
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCampaignName.trim()) return;

    try {
      if (audienceType === 'LIST') {
        const chosenList = crmLists.find(l => l.id === targetListId);
        const chosenTmpl = templates.find(t => t.id === selectedTemplateId) || templates[0];
        const contactLimit = chosenList ? chosenList.contact_count : newDailyGoal;

        await businessCenterApi.saveCampaign({
          name: newCampaignName.trim(),
          description: newDescription.trim() || `Audience ciblée : liste ${chosenList?.name || 'spécifique'}`,
          objective: `Envoi WhatsApp ciblé sur la liste ${chosenList?.name || ''}`,
          status: 'DRAFT',
          daily_goal: contactLimit || newDailyGoal,
          target_list_id: chosenList?.id,
          target_list_name: chosenList?.name,
          template_id: chosenTmpl?.id,
          template_name: chosenTmpl?.name,
          segment_allocations: [
            {
              segment_id: 'LIST_AUDIENCE',
              segment_name: chosenList?.name || 'Audience Liste',
              template_id: chosenTmpl?.id || 'tmpl_1',
              template_name: chosenTmpl?.name || 'Template Standard',
              daily_quota: contactLimit || newDailyGoal,
              prepared_count: 0,
              sent_count: 0,
              delivered_count: 0,
              failed_count: 0
            }
          ],
          exclusions: {
            exclude_recent_contact_days: 0,
            exclude_opt_out: true,
            exclude_tags: ['Exclus']
          }
        });
      } else {
        const defaultAllocations = [
          {
            segment_id: 'AVOCAT',
            segment_name: 'Avocats & Juridique',
            template_id: templates[0]?.id || 'tmpl_1',
            template_name: templates[0]?.name || 'Template A',
            daily_quota: Math.round(newDailyGoal * 0.2),
            prepared_count: 0,
            sent_count: 0,
            delivered_count: 0,
            failed_count: 0
          },
          {
            segment_id: 'COMPTABLE',
            segment_name: 'Experts-Comptables',
            template_id: templates[1]?.id || 'tmpl_2',
            template_name: templates[1]?.name || 'Template B',
            daily_quota: Math.round(newDailyGoal * 0.4),
            prepared_count: 0,
            sent_count: 0,
            delivered_count: 0,
            failed_count: 0
          },
          {
            segment_id: 'ENTREPRISE',
            segment_name: 'Entreprises & Sociétés',
            template_id: templates[2]?.id || templates[0]?.id || 'tmpl_3',
            template_name: templates[2]?.name || 'Template C',
            daily_quota: Math.round(newDailyGoal * 0.4),
            prepared_count: 0,
            sent_count: 0,
            delivered_count: 0,
            failed_count: 0
          }
        ];

        await businessCenterApi.saveCampaign({
          name: newCampaignName.trim(),
          description: newDescription.trim(),
          objective: 'Prospection multicanale et fidélisation WhatsApp',
          status: 'DRAFT',
          daily_goal: newDailyGoal,
          segment_allocations: defaultAllocations,
          exclusions: {
            exclude_recent_contact_days: 15,
            exclude_opt_out: true,
            exclude_tags: ['Exclus']
          }
        });
      }

      setIsModalOpen(false);
      setNewCampaignName('');
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const selectedListObj = crmLists.find(l => l.id === targetListId);
  const selectedTemplateObj = templates.find(t => t.id === selectedTemplateId);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            Campagnes WhatsApp & Audiences CRM
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Orchestrez des envois WhatsApp ciblés sur une liste CRM précise (ex : 10 contacts sélectionnés) ou sur des quotas multi-segments.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md self-start md:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nouvelle Campagne WhatsApp</span>
        </button>
      </div>

      {actionFeedback && (
        <div className="p-3 bg-emerald-950/70 border border-emerald-500/50 text-emerald-200 rounded-xl text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{actionFeedback}</span>
          </div>
          <button onClick={() => setActionFeedback(null)} className="text-emerald-400 font-bold ml-2 cursor-pointer">×</button>
        </div>
      )}

      {/* Grid of campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Colonne gauche : liste des campagnes */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Campagnes ({campaigns.length})
            </h3>
            {crmLists.length > 0 && (
              <span className="text-[11px] text-slate-500">
                {crmLists.length} listes CRM disponibles
              </span>
            )}
          </div>

          <div className="space-y-2">
            {campaigns.length === 0 ? (
              <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl text-center text-xs text-slate-400">
                <Layers className="w-6 h-6 mx-auto text-slate-600 mb-2" />
                <p>Aucune campagne créée pour le moment.</p>
                <button
                  onClick={handleOpenCreateModal}
                  className="mt-2.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Créer une première campagne
                </button>
              </div>
            ) : (
              campaigns.map(camp => {
                const isSelected = selectedCampaign?.id === camp.id;
                const isListTargeted = Boolean(camp.target_list_id);

                return (
                  <div
                    key={camp.id}
                    onClick={() => setSelectedCampaign(camp)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer group ${
                      isSelected
                        ? 'bg-slate-800/90 border-emerald-500 shadow-md ring-1 ring-emerald-500/30'
                        : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="text-xs font-bold text-slate-100 truncate pr-2">
                        {camp.name}
                      </h4>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          camp.status === 'RUNNING' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' :
                          camp.status === 'PAUSED' ? 'bg-amber-950 text-amber-300 border border-amber-500/30' :
                          camp.status === 'PREPARED' ? 'bg-blue-950 text-blue-300 border border-blue-500/30' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {camp.status}
                        </span>
                        <button
                          onClick={(e) => handleDeleteCampaign(camp.id, e)}
                          className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Supprimer la campagne"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Audience badge */}
                    <div className="mb-2">
                      {isListTargeted ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-500/40 text-[10px] font-semibold">
                          <ListFilter className="w-3 h-3 text-emerald-400" />
                          <span>Liste : {camp.target_list_name || 'Liste ciblée'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-950 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold">
                          <Users className="w-3 h-3 text-indigo-400" />
                          <span>Audience Multi-Segments</span>
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-2 mb-2">
                      {camp.description || camp.objective || 'Campagne WhatsApp'}
                    </p>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                      <span>Audience : <strong className="text-slate-200">{camp.daily_goal} contacts</strong></span>
                      <span>Transmis : <strong className="text-emerald-400">{camp.sent_jobs_count}</strong></span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Colonne droite : détail & orchestration de la campagne sélectionnée */}
        {selectedCampaign && (
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-xl">
            {/* Header campagne */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-100">
                    {selectedCampaign.name}
                  </h3>
                  <span className="text-xs px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-500/40 rounded-full font-mono font-bold">
                    {selectedCampaign.daily_goal} contacts cibles
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    selectedCampaign.status === 'RUNNING' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' :
                    selectedCampaign.status === 'PAUSED' ? 'bg-amber-950 text-amber-300 border border-amber-500/30' :
                    selectedCampaign.status === 'PREPARED' ? 'bg-blue-950 text-blue-300 border border-blue-500/30' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {selectedCampaign.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{selectedCampaign.objective}</p>
              </div>

              {/* Actions directes */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handlePrepare(selectedCampaign.id)}
                  disabled={isProcessing}
                  className="px-3 py-1.5 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Valide les contacts et prépare les messages"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                  <span>1. Préparer ({selectedCampaign.prepared_jobs_count || selectedCampaign.daily_goal})</span>
                </button>

                {selectedCampaign.status === 'RUNNING' ? (
                  <button
                    onClick={() => handlePause(selectedCampaign.id)}
                    className="px-3 py-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Mettre en pause</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleLaunch(selectedCampaign.id)}
                    disabled={isProcessing}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                    title="Transmet les messages dans la file d'attente du WhatsApp Sender"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>2. Lancer vers le Sender</span>
                  </button>
                )}

                <button
                  onClick={(e) => handleDeleteCampaign(selectedCampaign.id, e)}
                  className="p-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-500/30 rounded-lg text-xs transition-colors cursor-pointer"
                  title="Supprimer la campagne"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* AUDIENCE CARD */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ListFilter className="w-4 h-4 text-emerald-400" />
                  Audience Cible de la Campagne
                </span>

                {selectedCampaign.target_list_id && onNavigateToCrm && (
                  <button
                    onClick={() => onNavigateToCrm(selectedCampaign.target_list_id)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 underline cursor-pointer"
                  >
                    <span>Vérifier les contacts dans le CRM</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
              </div>

              {selectedCampaign.target_list_id ? (
                <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-emerald-200 text-sm">
                        Liste : {selectedCampaign.target_list_name || 'Liste CRM'}
                      </span>
                      <span className="text-[10px] bg-emerald-900 text-emerald-300 px-2 py-0.5 rounded font-mono font-bold">
                        {selectedCampaign.daily_goal} contacts
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Cette campagne n'envoie PAS aux 505+ contacts du CRM : elle est strictement restreinte aux {selectedCampaign.daily_goal} contacts de cette liste.
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-slate-400 text-[11px] block">Statut d'envoi</span>
                    <strong className="text-emerald-400 font-mono text-sm">
                      {selectedCampaign.sent_jobs_count} / {selectedCampaign.daily_goal} envoyés
                    </strong>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-lg text-xs text-indigo-200">
                  <p className="font-semibold">Audience Multi-Segments (Tous les contacts par quotas)</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Les contacts sont filtrés selon leurs segments respectifs (Avocats, Comptables, Entreprises).
                  </p>
                </div>
              )}
            </div>

            {/* Template et Quotas */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                <span>Modèle de message & Quotas</span>
                <span className="text-emerald-400 font-mono text-[11px]">
                  Préparés : {selectedCampaign.prepared_jobs_count} | Transmis : {selectedCampaign.sent_jobs_count}
                </span>
              </h4>

              {selectedCampaign.segment_allocations && selectedCampaign.segment_allocations.length > 0 ? (
                <div className="space-y-2.5">
                  {selectedCampaign.segment_allocations.map((alloc, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-100">{alloc.segment_name}</span>
                          <span className="text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded font-mono">
                            {alloc.segment_id}
                          </span>
                        </div>
                        <div className="text-slate-400 text-[11px] flex items-center gap-1.5">
                          <MessageSquare className="w-3 h-3 text-emerald-400" />
                          <span>Template :</span>
                          <strong className="text-emerald-300">{alloc.template_name || selectedCampaign.template_name || 'Standard'}</strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-[11px] shrink-0">
                        <div className="text-right">
                          <span className="text-slate-400 block">Quota Quotidien</span>
                          <strong className="text-slate-100 text-sm font-mono">{alloc.daily_quota} contacts</strong>
                        </div>

                        <div className="text-right pl-3 border-l border-slate-800">
                          <span className="text-slate-400 block">Délivrés Réels</span>
                          <strong className="text-emerald-400 text-sm font-mono">{alloc.delivered_count}</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                    <span>Template : <strong>{selectedCampaign.template_name || 'Standard'}</strong></span>
                  </div>
                  <span className="font-mono text-emerald-400">{selectedCampaign.daily_goal} contacts</span>
                </div>
              )}
            </div>

            {/* Traçabilité & Exclusions */}
            <div className="p-3.5 bg-slate-950/40 border border-slate-800/80 rounded-xl text-xs space-y-1.5 text-slate-400">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px] block">
                Garanties de conformité WhatsApp :
              </span>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                <li>Exclusion stricte des numéros ayant demandé l'arrêt (Opt-out / STOP).</li>
                <li>Isolement strict de l'audience : seuls les numéros de la liste sont préparés et transmis au Sender.</li>
                <li>Résolution automatique des civilités et prénoms personnalisés.</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Modal Création Campagne avec Sélection d'Audience */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                Créer une Campagne WhatsApp
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-base font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateCampaign} className="space-y-3.5 text-xs">
              {/* Type d'Audience */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1.5 font-bold uppercase">
                  1. Choix de l'Audience
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAudienceType('LIST')}
                    className={`p-2.5 rounded-xl border text-left font-semibold transition-all cursor-pointer ${
                      audienceType === 'LIST'
                        ? 'bg-emerald-950 border-emerald-500 text-emerald-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <ListFilter className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-bold">Liste CRM Ciblée</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 font-normal">
                      Ex: Vos 10 contacts sélectionnés (recommandé pour test)
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAudienceType('MULTI_SEGMENTS')}
                    className={`p-2.5 rounded-xl border text-left font-semibold transition-all cursor-pointer ${
                      audienceType === 'MULTI_SEGMENTS'
                        ? 'bg-indigo-950 border-indigo-500 text-indigo-200 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="font-bold">Multi-Segments</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 font-normal">
                      Répartition par quotas métier (Avocats, Comptables...)
                    </p>
                  </button>
                </div>
              </div>

              {/* Si Liste CRM sélectionnée : Dropdown des listes */}
              {audienceType === 'LIST' && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                  <label className="text-[10px] text-slate-300 block font-bold uppercase">
                    Sélectionnez la Liste CRM :
                  </label>
                  {crmLists.length === 0 ? (
                    <div className="text-amber-400 text-[11px] p-2 bg-amber-950/40 border border-amber-500/30 rounded-lg">
                      Aucune liste CRM trouvée. Rendez-vous dans l'onglet CRM, sélectionnez des contacts et cliquez sur "Créer Liste".
                    </div>
                  ) : (
                    <select
                      value={targetListId}
                      onChange={(e) => {
                        const listId = e.target.value;
                        setTargetListId(listId);
                        const l = crmLists.find(x => x.id === listId);
                        if (l) {
                          setNewDailyGoal(l.contact_count);
                          setNewCampaignName(`Test WhatsApp - ${l.name}`);
                        }
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100 font-semibold"
                    >
                      {crmLists.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.name} — ({l.contact_count} contacts)
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedListObj && (
                    <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 pt-1">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>
                        Cette campagne traitera exactement les <strong>{selectedListObj.contact_count} contacts</strong> de la liste.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Nom de la campagne */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1 font-bold uppercase">Nom de la Campagne *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Campagne Test WhatsApp 10"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-medium"
                />
              </div>

              {/* Choix du Template */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1 font-bold uppercase">Modèle de Message WhatsApp *</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                >
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.category})
                    </option>
                  ))}
                </select>
                {selectedTemplateObj && (
                  <div className="mt-1.5 p-2 bg-slate-950 border border-slate-800/80 rounded text-[11px] text-slate-400 font-mono line-clamp-2">
                    {selectedTemplateObj.content}
                  </div>
                )}
              </div>

              {/* Quota */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1 font-bold uppercase">
                  Nombre maximum de contacts à envoyer
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={500}
                  value={newDailyGoal}
                  onChange={(e) => setNewDailyGoal(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-slate-400 block mb-1 font-bold uppercase">Description / Stratégie</label>
                <input
                  type="text"
                  placeholder="ex: Test préliminaire sur 10 contacts vérifiés"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={audienceType === 'LIST' && crmLists.length === 0}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold rounded-lg shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Créer la Campagne</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
