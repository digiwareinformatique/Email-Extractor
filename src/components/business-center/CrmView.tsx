import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, Search, Plus, Filter, Download, Upload, Phone, Mail, Building, MapPin, 
  Check, X, Eye, ShieldCheck, Tag, Edit3, MessageCircle, Trash2, CheckSquare, 
  Square, Layers, Send, RefreshCw, AlertTriangle, ArrowRight, FolderPlus, ListFilter,
  CheckCircle2, Sparkles, ChevronLeft, ChevronRight, UserCheck, UserX, Clock, MessageSquare,
  ShieldAlert, ShieldX, XCircle, CheckCircle, HelpCircle, StopCircle
} from 'lucide-react';
import { 
  CrmContact, CivilityType, CrmList, CrmTag, CrmSegment, CrmContactsStats,
  WhatsAppValidationProgress, WhatsAppValidationStatus 
} from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

interface CrmViewProps {
  onOpenConversation?: (phone: string) => void;
  onNavigateToCampaigns?: (targetListId?: string) => void;
}

export const CrmView: React.FC<CrmViewProps> = ({ 
  onOpenConversation,
  onNavigateToCampaigns 
}) => {
  // Contacts data state
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [totalContacts, setTotalContacts] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(10);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [allMatchingIds, setAllMatchingIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Stats state
  const [stats, setStats] = useState<CrmContactsStats | null>(null);

  // Selection state
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());

  // Lists state
  const [lists, setLists] = useState<CrmList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState<string>('');
  const [isCreatingList, setIsCreatingList] = useState<boolean>(false);

  // Tags & Segments state
  const [tags, setTags] = useState<CrmTag[]>([]);
  const [segments, setSegments] = useState<CrmSegment[]>([]);
  const [newTagName, setNewTagName] = useState<string>('');
  const [newSegmentCode, setNewSegmentCode] = useState<string>('');
  const [newSegmentName, setNewSegmentName] = useState<string>('');

  // Filters state
  const [statusTab, setStatusTab] = useState<'ALL' | 'CLIENT' | 'PROSPECT' | 'RELANCE' | 'OPT_OUT' | 'REPONDU'>('ALL');
  const [whatsappFilter, setWhatsappFilter] = useState<'ALL' | 'EXISTS' | 'NOT_ON_WHATSAPP' | 'NOT_CHECKED' | 'ERROR'>('ALL');
  const [search, setSearch] = useState<string>('');
  const [civilityFilter, setCivilityFilter] = useState<string>('ALL');
  const [segmentFilter, setSegmentFilter] = useState<string>('ALL');
  const [tagFilter, setTagFilter] = useState<string>('ALL');
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState<boolean>(false);

  // WhatsApp Validation State
  const [isCheckingWhatsApp, setIsCheckingWhatsApp] = useState<boolean>(false);
  const [checkingSingleContactId, setCheckingSingleContactId] = useState<string | null>(null);
  const [validationProgress, setValidationProgress] = useState<WhatsAppValidationProgress | null>(null);
  const [validationSummaryModal, setValidationSummaryModal] = useState<{
    isOpen: boolean;
    total: number;
    existsCount: number;
    notOnWaCount: number;
    invalidCount: number;
    errorCount: number;
    validsContactIds: string[];
    notValidsContactIds: string[];
  } | null>(null);

  // Modals state
  const [isNewContactModalOpen, setIsNewContactModalOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState<boolean>(false);
  const [selectedContactDetail, setSelectedContactDetail] = useState<CrmContact | null>(null);

  // Delete confirmation modal state
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: 'single' | 'bulk';
    contactId?: string;
    contactName?: string;
    count?: number;
  }>({ isOpen: false, type: 'single' });

  // Import state
  const [importPasteText, setImportPasteText] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // New Contact form
  const [formData, setFormData] = useState<{
    phone: string;
    civility: CivilityType;
    first_name: string;
    last_name: string;
    company_name: string;
    profession: string;
    city: string;
    email: string;
    status: CrmContact['status'];
    segment: string;
  }>({
    phone: '',
    civility: 'Non spécifié',
    first_name: '',
    last_name: '',
    company_name: '',
    profession: '',
    city: '',
    email: '',
    status: 'PROSPECT',
    segment: 'ENTREPRISE'
  });

  // Initial load
  useEffect(() => {
    loadStats();
    loadLists();
    loadTagsAndSegments();
  }, []);

  // Reload contacts when filters or page change
  useEffect(() => {
    loadContacts();
  }, [page, limit, statusTab, whatsappFilter, search, civilityFilter, segmentFilter, tagFilter, selectedListId]);

  // Polling for WhatsApp validation progress if active
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isCheckingWhatsApp && validationProgress?.jobId && validationProgress.status === 'RUNNING') {
      interval = setInterval(async () => {
        try {
          const currentJob = await businessCenterApi.getWhatsAppValidationStatus(validationProgress.jobId);
          setValidationProgress(currentJob);

          if (currentJob.status === 'COMPLETED') {
            setIsCheckingWhatsApp(false);
            if (interval) clearInterval(interval);

            const valids = currentJob.results.filter((r: any) => r.status === 'EXISTS').map((r: any) => r.contactId);
            const notValids = currentJob.results.filter((r: any) => r.status === 'NOT_ON_WHATSAPP' || r.status === 'INVALID_FORMAT').map((r: any) => r.contactId);

            setValidationSummaryModal({
              isOpen: true,
              total: currentJob.total,
              existsCount: currentJob.existsCount,
              notOnWaCount: currentJob.notOnWaCount,
              invalidCount: currentJob.invalidCount,
              errorCount: currentJob.errorCount,
              validsContactIds: valids,
              notValidsContactIds: notValids
            });

            await Promise.all([loadContacts(), loadStats()]);
          } else if (currentJob.status === 'FAILED' || currentJob.status === 'CANCELLED') {
            setIsCheckingWhatsApp(false);
            if (interval) clearInterval(interval);
            await Promise.all([loadContacts(), loadStats()]);
          }
        } catch (e) {
          console.error('Error polling validation status:', e);
        }
      }, 500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isCheckingWhatsApp, validationProgress]);

  const loadStats = async () => {
    try {
      const res = await businessCenterApi.getCrmContactsStats();
      setStats(res);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  };

  const loadLists = async () => {
    try {
      const res = await businessCenterApi.getCrmLists();
      setLists(res);
    } catch (err) {
      console.error('Error loading lists:', err);
    }
  };

  const loadTagsAndSegments = async () => {
    try {
      const [tList, sList] = await Promise.all([
        businessCenterApi.getCrmTags(),
        businessCenterApi.getCrmSegments()
      ]);
      setTags(tList);
      setSegments(sList);
    } catch (err) {
      console.error('Error loading tags & segments:', err);
    }
  };

  const loadContacts = async () => {
    setIsLoading(true);
    try {
      const res = await businessCenterApi.getCrmContactsPaged({
        search: search.trim() || undefined,
        status: statusTab !== 'ALL' ? statusTab : undefined,
        whatsapp_status: whatsappFilter !== 'ALL' ? whatsappFilter : undefined,
        civility: civilityFilter !== 'ALL' ? civilityFilter : undefined,
        segment: segmentFilter !== 'ALL' ? segmentFilter : undefined,
        tag: tagFilter !== 'ALL' ? tagFilter : undefined,
        list_id: selectedListId || undefined,
        page,
        limit
      });
      setContacts(res.contacts);
      setTotalContacts(res.total);
      setTotalPages(res.totalPages);
      setAllMatchingIds(res.allMatchingIds || []);
    } catch (err) {
      console.error('Error loading contacts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------
  // WHATSAPP NUMBER VALIDATION HANDLERS
  // -------------------------------------------------------------

  const handleValidateSingleContact = async (contactId: string, forceRecheck: boolean = true) => {
    setCheckingSingleContactId(contactId);
    try {
      const res = await businessCenterApi.checkContactWhatsApp(contactId, forceRecheck);
      // Update locally
      setContacts(prev => prev.map(c => c.id === contactId ? {
        ...c,
        whatsapp_status: res.status as WhatsAppValidationStatus,
        whatsapp_jid: res.jid,
        whatsapp_check_error: res.error,
        whatsapp_checked_at: new Date().toISOString()
      } : c));

      if (selectedContactDetail && selectedContactDetail.id === contactId) {
        setSelectedContactDetail({
          ...selectedContactDetail,
          whatsapp_status: res.status as WhatsAppValidationStatus,
          whatsapp_jid: res.jid,
          whatsapp_check_error: res.error,
          whatsapp_checked_at: new Date().toISOString()
        });
      }

      await loadStats();
    } catch (err: any) {
      alert(`Erreur de vérification : ${err.message}`);
    } finally {
      setCheckingSingleContactId(null);
    }
  };

  const handleStartBatchValidation = async (targetIds?: string[]) => {
    const idsToValidate = targetIds && targetIds.length > 0 
      ? targetIds 
      : (Array.from(selectedContactIds) as string[]);

    if (idsToValidate.length === 0) {
      alert('Veuillez sélectionner au moins un contact à vérifier.');
      return;
    }

    try {
      const job = await businessCenterApi.startBatchWhatsAppValidation(idsToValidate, true, 3);
      setValidationProgress(job);
      setIsCheckingWhatsApp(true);
    } catch (err: any) {
      alert(`Impossible de lancer la vérification : ${err.message}`);
    }
  };

  const handleCancelValidation = async () => {
    if (!validationProgress?.jobId) return;
    try {
      await businessCenterApi.cancelWhatsAppValidation(validationProgress.jobId);
      setIsCheckingWhatsApp(false);
      await Promise.all([loadContacts(), loadStats()]);
    } catch (err: any) {
      console.error('Cancel error:', err);
    }
  };

  const handleCreateListFromValids = async (validIds: string[]) => {
    if (validIds.length === 0) {
      alert('Aucun contact WhatsApp valide trouvé dans ce lot.');
      return;
    }
    const name = window.prompt(
      `Nom de la liste pour ces ${validIds.length} contacts WhatsApp vérifiés :`,
      `Test WhatsApp — ${validIds.length} Valides`
    );
    if (!name || !name.trim()) return;

    try {
      const created = await businessCenterApi.createCrmList(name.trim(), validIds);
      await loadLists();
      setSelectedListId(created.id);
      setPage(1);
      setValidationSummaryModal(null);
      alert(`✓ Liste "${created.name}" créée avec ${validIds.length} contacts WhatsApp vérifiés.`);
    } catch (err: any) {
      alert(`Erreur création liste : ${err.message}`);
    }
  };

  // -------------------------------------------------------------
  // SELECTION HANDLERS
  // -------------------------------------------------------------

  const handleToggleSelectOne = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectCurrentPage = () => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      contacts.forEach(c => next.add(c.id));
      return next;
    });
  };

  const handleUnselectCurrentPage = () => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      contacts.forEach(c => next.delete(c.id));
      return next;
    });
  };

  const handleSelectAllMatching = () => {
    setSelectedContactIds(new Set(allMatchingIds));
  };

  const handleUnselectAll = () => {
    setSelectedContactIds(new Set());
  };

  const selectedCount = selectedContactIds.size;
  const isAllCurrentPageSelected = contacts.length > 0 && contacts.every(c => selectedContactIds.has(c.id));

  // -------------------------------------------------------------
  // LISTS, TAGS, SEGMENTS OPERATIONS
  // -------------------------------------------------------------

  const handleCreateList = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newListName.trim()) return;

    setIsCreatingList(true);
    try {
      const idsToInclude = Array.from(selectedContactIds) as string[];
      const created = await businessCenterApi.createCrmList(newListName.trim(), idsToInclude);
      setNewListName('');
      await loadLists();
      setSelectedListId(created.id);
      setPage(1);
    } catch (err) {
      console.error('Error creating list:', err);
    } finally {
      setIsCreatingList(false);
    }
  };

  const handleDeleteList = async (listId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Supprimer cette liste ? (Les contacts resteront dans le CRM)')) return;
    try {
      await businessCenterApi.deleteCrmList(listId);
      if (selectedListId === listId) {
        setSelectedListId(null);
        setPage(1);
      }
      await loadLists();
    } catch (err) {
      console.error('Error deleting list:', err);
    }
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    try {
      await businessCenterApi.createCrmTag(newTagName.trim());
      setNewTagName('');
      await loadTagsAndSegments();
    } catch (err) {
      console.error('Error creating tag:', err);
    }
  };

  const handleCreateSegment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSegmentCode.trim() || !newSegmentName.trim()) return;
    try {
      await businessCenterApi.createCrmSegment(newSegmentCode.trim(), newSegmentName.trim());
      setNewSegmentCode('');
      setNewSegmentName('');
      await loadTagsAndSegments();
    } catch (err) {
      console.error('Error creating segment:', err);
    }
  };

  // -------------------------------------------------------------
  // CONTACT CRUD & IMPORT
  // -------------------------------------------------------------

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.phone.trim()) return;

    try {
      await businessCenterApi.saveCrmContact({
        phone: formData.phone.trim(),
        civility: formData.civility,
        first_name: formData.first_name.trim() || undefined,
        last_name: formData.last_name.trim() || undefined,
        company_name: formData.company_name.trim() || undefined,
        profession: formData.profession.trim() || undefined,
        city: formData.city.trim() || undefined,
        email: formData.email.trim() || undefined,
        status: formData.status,
        segments: [formData.segment],
        tags: ['Création Manuelle'],
        consent_given: true,
        opt_out: false
      });

      setIsNewContactModalOpen(false);
      setFormData({
        phone: '',
        civility: 'Non spécifié',
        first_name: '',
        last_name: '',
        company_name: '',
        profession: '',
        city: '',
        email: '',
        status: 'PROSPECT',
        segment: 'ENTREPRISE'
      });
      await Promise.all([loadContacts(), loadStats()]);
    } catch (err: any) {
      alert(`Erreur : ${err.message}`);
    }
  };

  const handlePromptDeleteSingle = (contact: CrmContact, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteModal({
      isOpen: true,
      type: 'single',
      contactId: contact.id,
      contactName: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.phone
    });
  };

  const handlePromptDeleteBulk = () => {
    if (selectedCount === 0) return;
    setDeleteModal({
      isOpen: true,
      type: 'bulk',
      count: selectedCount
    });
  };

  const handleExecuteDelete = async () => {
    try {
      if (deleteModal.type === 'single' && deleteModal.contactId) {
        await businessCenterApi.deleteCrmContact(deleteModal.contactId);
        setSelectedContactIds(prev => {
          const next = new Set(prev);
          next.delete(deleteModal.contactId!);
          return next;
        });
      } else if (deleteModal.type === 'bulk') {
        const ids = Array.from(selectedContactIds) as string[];
        await businessCenterApi.bulkDeleteCrmContacts(ids);
        setSelectedContactIds(new Set());
      }
      setDeleteModal({ isOpen: false, type: 'single' });
      await Promise.all([loadContacts(), loadStats(), loadLists()]);
    } catch (err) {
      console.error('Error deleting contact(s):', err);
    }
  };

  const handleSyncLeads = async () => {
    setIsImporting(true);
    setImportNotice(null);
    try {
      const res = await businessCenterApi.syncLeadsToCrm();
      setImportNotice(`✓ ${res.synced} leads synchronisés dans le CRM (Total : ${res.totalInCrm}).`);
      await Promise.all([loadContacts(), loadStats()]);
    } catch (err: any) {
      setImportNotice(`Erreur : ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!importPasteText.trim()) return;
    setIsImporting(true);
    setImportNotice(null);

    const lines = importPasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsedContacts: Partial<CrmContact>[] = [];

    for (const line of lines) {
      const parts = line.split(/[,;\t]/).map(p => p.trim());
      const phone = parts[0];
      if (!phone) continue;

      parsedContacts.push({
        phone,
        first_name: parts[1] || undefined,
        company_name: parts[2] || undefined,
        city: parts[3] || undefined,
        status: 'PROSPECT',
        tags: ['Import Masse CRM'],
        segments: ['ENTREPRISE']
      });
    }

    try {
      const res = await businessCenterApi.importCrmContacts(parsedContacts);
      setImportNotice(`✓ ${res.imported} nouveaux contacts importés, ${res.updated} mis à jour.`);
      setImportPasteText('');
      await Promise.all([loadContacts(), loadStats()]);
    } catch (err: any) {
      setImportNotice(`Erreur lors de l'import : ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const activeList = lists.find(l => l.id === selectedListId);

  // WhatsApp status badge component
  const renderWhatsAppBadge = (status?: WhatsAppValidationStatus, checkDate?: string, contactId?: string) => {
    const isCheckingThis = checkingSingleContactId === contactId;

    if (isCheckingThis) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/40 animate-pulse">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span>Vérification...</span>
        </span>
      );
    }

    switch (status) {
      case 'EXISTS':
        return (
          <span 
            title={`WhatsApp vérifié et actif${checkDate ? ' le ' + new Date(checkDate).toLocaleDateString() : ''}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40"
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
            <span>WhatsApp Actif</span>
          </span>
        );
      case 'NOT_ON_WHATSAPP':
        return (
          <span 
            title="Numéro interrogé et non enregistré sur WhatsApp"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-500/40"
          >
            <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
            <span>Non WhatsApp</span>
          </span>
        );
      case 'INVALID_FORMAT':
        return (
          <span 
            title="Format de numéro invalide"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500/40"
          >
            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
            <span>Format Invalide</span>
          </span>
        );
      case 'ERROR':
        return (
          <span 
            title="Erreur lors de la vérification WhatsApp"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-950 text-orange-300 border border-orange-500/40"
          >
            <ShieldAlert className="w-3 h-3 text-orange-400 shrink-0" />
            <span>Erreur Check</span>
          </span>
        );
      case 'NOT_CHECKED':
      default:
        return (
          <span 
            title="Pas encore vérifié sur WhatsApp"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400"
          >
            <HelpCircle className="w-3 h-3 text-slate-500 shrink-0" />
            <span>Non vérifié</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* TOP BAR: STATS SUMMARY & PRIMARY ACTIONS */}
      <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            CRM & Base Contacts WhatsApp Pro
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {stats?.total || totalContacts} contacts qualifiés • {stats?.whatsapp_exists || 0} comptes WhatsApp vérifiés • {lists.length} listes d'audiences
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>Importation en masse</span>
          </button>

          <button
            onClick={() => setIsNewContactModalOpen(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nouveau Contact</span>
          </button>
        </div>
      </div>

      {/* WHATSAPP VALIDATION STATS FILTER TABS */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
        <button
          onClick={() => { setWhatsappFilter('ALL'); setStatusTab('ALL'); setPage(1); }}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            whatsappFilter === 'ALL' && statusTab === 'ALL'
              ? 'bg-slate-100 text-slate-950 shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <span>Tous les contacts</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
            {stats?.total || 0}
          </span>
        </button>

        <button
          onClick={() => { setWhatsappFilter('EXISTS'); setStatusTab('ALL'); setPage(1); }}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            whatsappFilter === 'EXISTS'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-slate-900 text-emerald-400 hover:bg-emerald-950/40 border border-slate-800'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>WhatsApp Disponibles</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-950 text-emerald-300 font-mono border border-emerald-500/30">
            {stats?.whatsapp_exists || 0}
          </span>
        </button>

        <button
          onClick={() => { setWhatsappFilter('NOT_ON_WHATSAPP'); setStatusTab('ALL'); setPage(1); }}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            whatsappFilter === 'NOT_ON_WHATSAPP'
              ? 'bg-rose-600 text-white shadow-md'
              : 'bg-slate-900 text-rose-400 hover:bg-rose-950/40 border border-slate-800'
          }`}
        >
          <XCircle className="w-3.5 h-3.5" />
          <span>Non WhatsApp</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-950 text-rose-300 font-mono border border-rose-500/30">
            {stats?.whatsapp_not_on || 0}
          </span>
        </button>

        <button
          onClick={() => { setWhatsappFilter('NOT_CHECKED'); setStatusTab('ALL'); setPage(1); }}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            whatsappFilter === 'NOT_CHECKED'
              ? 'bg-slate-700 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>Non Vérifiés</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-400 font-mono">
            {stats?.whatsapp_not_checked || 0}
          </span>
        </button>

        <button
          onClick={() => { setWhatsappFilter('ERROR'); setStatusTab('ALL'); setPage(1); }}
          className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
            whatsappFilter === 'ERROR'
              ? 'bg-orange-600 text-white shadow-md'
              : 'bg-slate-900 text-orange-400 hover:bg-orange-950/40 border border-slate-800'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Erreurs / Invalides</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-orange-950 text-orange-300 font-mono border border-orange-500/30">
            {(stats?.whatsapp_error || 0) + (stats?.whatsapp_invalid || 0)}
          </span>
        </button>
      </div>

      {/* 2-COLUMN LAYOUT: SIDEBAR (LISTS & TAGS) + MAIN CONTENT */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        {/* LEFT COLUMN: LISTS, TAGS & SEGMENTS */}
        <div className="space-y-4">
          {/* SECTION LISTES CRM */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <ListFilter className="w-4 h-4 text-emerald-400" />
                Listes CRM ({lists.length})
              </h3>
              {selectedListId && (
                <button
                  onClick={() => { setSelectedListId(null); setPage(1); }}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                >
                  Toutes
                </button>
              )}
            </div>

            {/* Create List: [ Nom de la liste... ] [ + Créer ] */}
            <form onSubmit={handleCreateList} className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Nom de la liste..."
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={!newListName.trim() || isCreatingList}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                title={selectedCount > 0 ? `Créer avec les ${selectedCount} contacts sélectionnés` : "Créer une liste"}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Créer</span>
              </button>
            </form>

            {/* List collection */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar pt-1">
              {lists.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic py-2">
                  Aucune liste créée. Sélectionnez des contacts pour en créer une.
                </p>
              ) : (
                lists.map(list => {
                  const isSelected = selectedListId === list.id;
                  return (
                    <div
                      key={list.id}
                      onClick={() => {
                        setSelectedListId(isSelected ? null : list.id);
                        setPage(1);
                      }}
                      className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all cursor-pointer group ${
                        isSelected
                          ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-200 shadow-sm'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        <span className="font-semibold truncate">{list.name}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300 font-bold">
                          {list.contact_count}
                        </span>
                        <button
                          onClick={(e) => handleDeleteList(list.id, e)}
                          className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Supprimer la liste"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* SECTION TAGS */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Tag className="w-4 h-4 text-indigo-400" />
                Tags
              </h3>
              {tagFilter !== 'ALL' && (
                <button
                  onClick={() => { setTagFilter('ALL'); setPage(1); }}
                  className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  Tous
                </button>
              )}
            </div>

            <form onSubmit={handleCreateTag} className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Nouveau tag..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden"
              />
              <button
                type="submit"
                disabled={!newTagName.trim()}
                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Créer</span>
              </button>
            </form>

            <div className="flex flex-wrap gap-1.5 pt-1 max-h-36 overflow-y-auto no-scrollbar">
              {tags.map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTagFilter(tagFilter === t.name ? 'ALL' : t.name);
                    setPage(1);
                  }}
                  className={`text-[10px] px-2 py-0.8 rounded-lg font-semibold border transition-all cursor-pointer ${
                    tagFilter === t.name
                      ? 'bg-indigo-950 border-indigo-500 text-indigo-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  #{t.name}
                </button>
              ))}
            </div>
          </div>

          {/* SECTION SEGMENTS */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                Segments Métier
              </h3>
              {segmentFilter !== 'ALL' && (
                <button
                  onClick={() => { setSegmentFilter('ALL'); setPage(1); }}
                  className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  Tous
                </button>
              )}
            </div>

            <form onSubmit={handleCreateSegment} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="CODE (ex: IMMO)"
                  value={newSegmentCode}
                  onChange={(e) => setNewSegmentCode(e.target.value)}
                  className="w-1/3 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 font-mono uppercase focus:outline-hidden"
                />
                <input
                  type="text"
                  placeholder="Nom du segment..."
                  value={newSegmentName}
                  onChange={(e) => setNewSegmentName(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden"
                />
                <button
                  type="submit"
                  disabled={!newSegmentCode.trim() || !newSegmentName.trim()}
                  className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            <div className="space-y-1 pt-1">
              {segments.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSegmentFilter(segmentFilter === s.code ? 'ALL' : s.code);
                    setPage(1);
                  }}
                  className={`w-full text-left p-1.5 rounded-lg text-xs font-medium border flex items-center justify-between transition-all cursor-pointer ${
                    segmentFilter === s.code
                      ? 'bg-purple-950/80 border-purple-500 text-purple-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="font-mono text-[9px] bg-slate-800 px-1.5 py-0.2 rounded font-bold">
                    {s.code}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* MAIN COLUMN: SEARCH & FILTERS + SELECTION ACTIONS + TABLE */}
        <div className="lg:col-span-3 space-y-3">
          {/* SEARCH & FILTER BAR */}
          <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-center gap-2.5 text-xs shadow-md">
            <div className="relative flex-1 w-full">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Rechercher nom, entreprise, téléphone, ville, profession..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            {/* Filter Toggle Button */}
            <button
              onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
              className={`px-3 py-1.5 rounded-xl border flex items-center gap-1.5 font-semibold transition-all cursor-pointer shrink-0 ${
                isFilterPanelOpen || civilityFilter !== 'ALL' || segmentFilter !== 'ALL' || tagFilter !== 'ALL'
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/60'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <Filter className="w-3.5 h-3.5 text-emerald-400" />
              <span>Filtrer</span>
              {(civilityFilter !== 'ALL' || segmentFilter !== 'ALL' || tagFilter !== 'ALL') && (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </button>
          </div>

          {/* Collapsible Filter Panel */}
          {isFilterPanelOpen && (
            <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs animate-in fade-in">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Civilité</label>
                <select
                  value={civilityFilter}
                  onChange={(e) => { setCivilityFilter(e.target.value); setPage(1); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-200"
                >
                  <option value="ALL">Toutes les civilités</option>
                  <option value="Maître">Maître (Avocats, Notaires)</option>
                  <option value="Docteur">Docteur (Médecins)</option>
                  <option value="Monsieur">Monsieur</option>
                  <option value="Madame">Madame</option>
                  <option value="Non spécifié">Non spécifié</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Segment</label>
                <select
                  value={segmentFilter}
                  onChange={(e) => { setSegmentFilter(e.target.value); setPage(1); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-200"
                >
                  <option value="ALL">Tous les segments</option>
                  {segments.map(s => (
                    <option key={s.id} value={s.code}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Tag</label>
                <select
                  value={tagFilter}
                  onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-200"
                >
                  <option value="ALL">Tous les tags</option>
                  {tags.map(t => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Active Filter Notice Banner if filtering by list */}
          {activeList && (
            <div className="p-3.5 bg-emerald-950/80 border border-emerald-500/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-200 animate-in fade-in shadow-md">
              <div className="flex items-center gap-2.5">
                <ListFilter className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-emerald-100">
                      Liste active : {activeList.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-900 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-[10px]">
                      {totalContacts} contacts vérifiés
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-300/80 mt-0.5">
                    Seuls les contacts de cette liste sont affichés ci-dessous et seront ciblés dans la campagne.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 flex-wrap">
                <button
                  onClick={() => handleStartBatchValidation(activeList.contact_ids)}
                  disabled={isCheckingWhatsApp || activeList.contact_ids.length === 0}
                  className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-300 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                  title="Vérifier la validité WhatsApp de tous les contacts de cette liste"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Vérifier WhatsApp ({activeList.contact_ids.length})</span>
                </button>

                {onNavigateToCampaigns && (
                  <button
                    onClick={() => onNavigateToCampaigns(activeList.id)}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Créer Campagne ({totalContacts})</span>
                  </button>
                )}
                <button
                  onClick={() => { setSelectedListId(null); setPage(1); }}
                  className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  Tous
                </button>
              </div>
            </div>
          )}

          {/* SELECTION ACTIONS TOOLBAR (Real Multi-Selection controls) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col md:flex-row items-center justify-between gap-3 text-xs shadow-md">
            {/* Left: Buttons "Sélectionner cette page (10)" and "Tout sélectionner (X leads)" */}
            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
              <button
                type="button"
                onClick={isAllCurrentPageSelected ? handleUnselectCurrentPage : handleSelectCurrentPage}
                className={`px-3 py-1.5 rounded-xl border font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  isAllCurrentPageSelected
                    ? 'bg-indigo-900 text-indigo-100 border-indigo-500'
                    : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                }`}
              >
                {isAllCurrentPageSelected ? (
                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400" />
                )}
                <span>Sélectionner cette page ({contacts.length})</span>
              </button>

              <button
                type="button"
                onClick={handleSelectAllMatching}
                className={`px-3 py-1.5 rounded-xl border font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  selectedCount === totalContacts && totalContacts > 0
                    ? 'bg-emerald-900 text-emerald-100 border-emerald-500'
                    : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border-slate-800'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Tout sélectionner ({totalContacts})</span>
              </button>

              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={handleUnselectAll}
                  className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 text-xs transition-colors cursor-pointer"
                >
                  Désélectionner tout
                </button>
              )}
            </div>

            {/* Right: Selected Counter & Actions on Selected */}
            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
              <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-slate-200">
                <span className="text-emerald-400 font-mono">{selectedCount}</span> sélectionné{selectedCount > 1 ? 's' : ''}
              </div>

              {selectedCount > 0 && (
                <>
                  {/* WhatsApp Validation Button on Selection */}
                  <button
                    onClick={() => handleStartBatchValidation()}
                    disabled={isCheckingWhatsApp}
                    className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/50 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                    title="Vérifier si ces numéros possèdent un compte WhatsApp actif"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Vérifier WhatsApp ({selectedCount})</span>
                  </button>

                  {/* Create List from selection */}
                  <button
                    onClick={() => {
                      const name = window.prompt(`Nom de la liste pour ces ${selectedCount} contacts :`, `Test WhatsApp ${selectedCount}`);
                      if (name && name.trim()) {
                        businessCenterApi.createCrmList(name.trim(), Array.from(selectedContactIds) as string[])
                          .then((created) => {
                            loadLists();
                            setSelectedListId(created.id);
                            setPage(1);
                          });
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm"
                    title="Créer une liste contenant ces contacts"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Créer Liste ({selectedCount})</span>
                  </button>

                  {/* Launch WhatsApp campaign from selection */}
                  <button
                    onClick={async () => {
                      let listIdToUse = selectedListId;
                      if (!listIdToUse) {
                        const name = window.prompt(`Nom de la liste pour ces ${selectedCount} contacts avant lancement :`, `Test WhatsApp ${selectedCount}`);
                        if (!name || !name.trim()) return;
                        const created = await businessCenterApi.createCrmList(name.trim(), Array.from(selectedContactIds) as string[]);
                        await loadLists();
                        setSelectedListId(created.id);
                        listIdToUse = created.id;
                      }
                      if (onNavigateToCampaigns) {
                        onNavigateToCampaigns(listIdToUse || undefined);
                      } else {
                        setIsCampaignModalOpen(true);
                      }
                    }}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center gap-1 transition-all cursor-pointer shadow-sm"
                    title="Utiliser cette sélection comme audience pour une campagne WhatsApp"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Lancer Campagne ({selectedCount})</span>
                  </button>

                  {/* Bulk Delete */}
                  <button
                    onClick={handlePromptDeleteBulk}
                    className="p-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 rounded-xl transition-all cursor-pointer"
                    title={`Supprimer les ${selectedCount} contacts sélectionnés`}
                  >
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* CONTACTS DATA TABLE */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
                  <tr>
                    {/* Select column */}
                    <th className="py-3 px-3 w-8 text-center">
                      <input
                        type="checkbox"
                        checked={isAllCurrentPageSelected}
                        onChange={isAllCurrentPageSelected ? handleUnselectCurrentPage : handleSelectCurrentPage}
                        className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3">Contact & Civilité</th>
                    <th className="py-3 px-3">Téléphone</th>
                    <th className="py-3 px-3">Compte WhatsApp</th>
                    <th className="py-3 px-3">Entreprise & Métier</th>
                    <th className="py-3 px-3">Segments & Tags</th>
                    <th className="py-3 px-3">Statut</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400 mb-2" />
                        <p className="font-semibold">Chargement des contacts...</p>
                      </td>
                    </tr>
                  ) : contacts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        <Users className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                        <p className="font-semibold text-slate-400">Aucun contact trouvé pour ces critères.</p>
                        <p className="text-xs text-slate-600 mt-1">Utilisez le bouton "Importation en masse" ou modifiez vos filtres.</p>
                      </td>
                    </tr>
                  ) : (
                    contacts.map(c => {
                      const isSelected = selectedContactIds.has(c.id);
                      return (
                        <tr 
                          key={c.id} 
                          onClick={() => handleToggleSelectOne(c.id)}
                          className={`transition-colors cursor-pointer ${
                            isSelected ? 'bg-emerald-950/30' : 'hover:bg-slate-800/40'
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="py-3 px-3 text-center" onClick={(e) => handleToggleSelectOne(c.id, e)}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          </td>

                          {/* Contact & Civilité */}
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-100 flex items-center gap-1.5">
                              {c.civility !== 'Non spécifié' && (
                                <span className="text-emerald-400 font-normal">{c.civility}</span>
                              )}
                              <span>{c.first_name || ''} {c.last_name || ''}</span>
                              {!c.first_name && !c.last_name && (
                                <span className="text-slate-400 italic">Non renseigné</span>
                              )}
                            </div>
                            {c.city && <span className="text-[10px] text-slate-500 block">{c.city}</span>}
                          </td>

                          {/* Phone */}
                          <td className="py-3 px-3 font-mono text-emerald-400 font-semibold whitespace-nowrap">
                            {c.phone}
                          </td>

                          {/* WhatsApp Status Column */}
                          <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              {renderWhatsAppBadge(c.whatsapp_status, c.whatsapp_checked_at, c.id)}
                              <button
                                type="button"
                                onClick={() => handleValidateSingleContact(c.id, true)}
                                disabled={checkingSingleContactId === c.id}
                                className="p-1 text-slate-500 hover:text-emerald-400 hover:bg-emerald-950/40 rounded transition-colors cursor-pointer"
                                title="Vérifier la présence WhatsApp en direct"
                              >
                                <RefreshCw className={`w-3 h-3 ${checkingSingleContactId === c.id ? 'animate-spin text-emerald-400' : ''}`} />
                              </button>
                            </div>
                          </td>

                          {/* Company & Profession */}
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-200">{c.company_name || '—'}</div>
                            <div className="text-[10px] text-slate-400">{c.profession || ''}</div>
                          </td>

                          {/* Segments & Tags */}
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1">
                              {c.segments.map((seg, idx) => (
                                <span key={idx} className="bg-indigo-950 text-indigo-300 border border-indigo-500/30 text-[9px] px-1.5 py-0.5 rounded font-semibold">
                                  {seg}
                                </span>
                              ))}
                              {c.tags.slice(0, 2).map((t, idx) => (
                                <span key={idx} className="bg-slate-800 text-slate-400 text-[9px] px-1.5 py-0.5 rounded">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              c.status === 'CLIENT' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' :
                              c.status === 'PROSPECT' ? 'bg-blue-950 text-blue-300 border border-blue-500/30' :
                              c.status === 'RELANCE' ? 'bg-amber-950 text-amber-300 border border-amber-500/30' :
                              c.opt_out ? 'bg-rose-950 text-rose-300 border border-rose-500/30' :
                              'bg-slate-800 text-slate-400'
                            }`}>
                              {c.opt_out ? 'Opt-Out' : c.status}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setSelectedContactDetail(c)}
                                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                title="Voir la fiche détaillée"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {onOpenConversation && (
                                <button
                                  onClick={() => onOpenConversation(c.phone)}
                                  className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 rounded-lg transition-colors cursor-pointer"
                                  title="Ouvrir la conversation WhatsApp"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                </button>
                              )}

                              <button
                                onClick={(e) => handlePromptDeleteSingle(c, e)}
                                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                                title="Supprimer ce contact"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* PAGINATION FOOTER */}
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span>
                  Affichage {totalContacts === 0 ? 0 : (page - 1) * limit + 1} à {Math.min(page * limit, totalContacts)} sur <strong>{totalContacts}</strong> contacts
                </span>
                <select
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-200"
                >
                  <option value="10">10 par page</option>
                  <option value="25">25 par page</option>
                  <option value="50">50 par page</option>
                  <option value="100">100 par page</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(prev => Math.max(prev - 1, 1))}
                  disabled={page <= 1}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg border border-slate-800 flex items-center gap-1 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Précédent</span>
                </button>

                <span className="px-3 py-1 bg-slate-900 rounded-lg border border-slate-800 font-mono">
                  Page {page} / {totalPages}
                </span>

                <button
                  onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={page >= totalPages}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg border border-slate-800 flex items-center gap-1 cursor-pointer"
                >
                  <span>Suivant</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: VALIDATION EN COURS (LIVE PROGRESS) */}
      {isCheckingWhatsApp && validationProgress && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Vérification des numéros WhatsApp
              </h3>
              <button
                onClick={handleCancelValidation}
                className="text-xs text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
              >
                Annuler
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between text-slate-300">
                <span>Progression :</span>
                <span className="font-mono font-bold text-emerald-400">
                  {validationProgress.processed} / {validationProgress.total} ({Math.round((validationProgress.processed / (validationProgress.total || 1)) * 100)}%)
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.round((validationProgress.processed / (validationProgress.total || 1)) * 100))}%` }}
                />
              </div>

              {/* Real Counters Grid */}
              <div className="grid grid-cols-3 gap-2 pt-2 text-center">
                <div className="p-2.5 bg-emerald-950/60 border border-emerald-500/40 rounded-xl">
                  <span className="text-[10px] text-emerald-400 font-bold block">DISPONIBLES</span>
                  <strong className="text-sm font-mono text-emerald-200">{validationProgress.existsCount}</strong>
                </div>

                <div className="p-2.5 bg-rose-950/60 border border-rose-500/40 rounded-xl">
                  <span className="text-[10px] text-rose-400 font-bold block">ABSENTS</span>
                  <strong className="text-sm font-mono text-rose-200">{validationProgress.notOnWaCount}</strong>
                </div>

                <div className="p-2.5 bg-amber-950/60 border border-amber-500/40 rounded-xl">
                  <span className="text-[10px] text-amber-400 font-bold block">ERREURS</span>
                  <strong className="text-sm font-mono text-amber-200">{validationProgress.errorCount + validationProgress.invalidCount}</strong>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 text-center italic">
                Interrogation sécurisée du socket WhatsApp Web (3 requêtes concurrentes)...
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={handleCancelValidation}
                className="px-3.5 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Interrompre la vérification</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RÉSUMÉ POST-VÉRIFICATION WHATSAPP */}
      {validationSummaryModal?.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Vérification WhatsApp Terminée
              </h3>
              <button
                onClick={() => setValidationSummaryModal(null)}
                className="text-slate-400 hover:text-slate-200 text-base font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <p className="text-slate-300">
                L'analyse des <strong>{validationSummaryModal.total} contacts</strong> sélectionnés est terminée avec succès :
              </p>

              {/* Counters Summary */}
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="p-3 bg-emerald-950/70 border border-emerald-500/50 rounded-xl">
                  <span className="text-[10px] text-emerald-400 font-bold block uppercase">🟢 WhatsApp Disponibles</span>
                  <strong className="text-lg font-mono text-emerald-200 block mt-1">{validationSummaryModal.existsCount}</strong>
                </div>

                <div className="p-3 bg-rose-950/70 border border-rose-500/50 rounded-xl">
                  <span className="text-[10px] text-rose-400 font-bold block uppercase">🔴 Non Inscrits</span>
                  <strong className="text-lg font-mono text-rose-200 block mt-1">{validationSummaryModal.notOnWaCount}</strong>
                </div>

                <div className="p-3 bg-amber-950/70 border border-amber-500/50 rounded-xl">
                  <span className="text-[10px] text-amber-400 font-bold block uppercase">⚠️ Erreurs / Invalides</span>
                  <strong className="text-lg font-mono text-amber-200 block mt-1">{validationSummaryModal.errorCount + validationSummaryModal.invalidCount}</strong>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <p className="font-semibold text-slate-200">Recommandation pour vos campagnes :</p>
                <p>
                  Créez une liste d'audience contenant uniquement les <strong>{validationSummaryModal.existsCount} contacts valides</strong> pour garantir un taux de délivrabilité maximal sans erreurs d'envoi.
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setWhatsappFilter('EXISTS');
                    setValidationSummaryModal(null);
                    setPage(1);
                  }}
                  className="flex-1 sm:flex-none px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-xl font-semibold cursor-pointer"
                >
                  Afficher les {validationSummaryModal.existsCount} valides
                </button>

                {validationSummaryModal.notOnWaCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setWhatsappFilter('NOT_ON_WHATSAPP');
                      setValidationSummaryModal(null);
                      setPage(1);
                    }}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-300 rounded-xl font-semibold cursor-pointer"
                  >
                    Afficher les {validationSummaryModal.notOnWaCount} exclus
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setValidationSummaryModal(null)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl cursor-pointer"
                >
                  Fermer
                </button>

                <button
                  type="button"
                  onClick={() => handleCreateListFromValids(validationSummaryModal.validsContactIds)}
                  disabled={validationSummaryModal.existsCount === 0}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Créer Liste des {validationSummaryModal.existsCount} Valides</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: FICHE DÉTAILLÉE CONTACT */}
      {selectedContactDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 shadow-2xl animate-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  {selectedContactDetail.civility !== 'Non spécifié' ? `${selectedContactDetail.civility} ` : ''}
                  {selectedContactDetail.first_name || ''} {selectedContactDetail.last_name || ''}
                </h3>
              </div>
              <button
                onClick={() => setSelectedContactDetail(null)}
                className="text-slate-400 hover:text-slate-200 text-base font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* WhatsApp Verification Card in Detail */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Vérification Compte WhatsApp
                  </span>
                  {renderWhatsAppBadge(selectedContactDetail.whatsapp_status, selectedContactDetail.whatsapp_checked_at, selectedContactDetail.id)}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="text-[11px] text-slate-400 font-mono">
                    Numéro : <strong className="text-emerald-400">{selectedContactDetail.phone}</strong>
                  </div>
                  <button
                    onClick={() => handleValidateSingleContact(selectedContactDetail.id, true)}
                    disabled={checkingSingleContactId === selectedContactDetail.id}
                    className="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 rounded-lg font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${checkingSingleContactId === selectedContactDetail.id ? 'animate-spin' : ''}`} />
                    <span>Revérifier</span>
                  </button>
                </div>

                {selectedContactDetail.whatsapp_checked_at && (
                  <p className="text-[10px] text-slate-500 italic">
                    Dernière vérification : {new Date(selectedContactDetail.whatsapp_checked_at).toLocaleString()}
                  </p>
                )}
                {selectedContactDetail.whatsapp_check_error && (
                  <p className="text-[10px] text-rose-400">
                    Détail erreur : {selectedContactDetail.whatsapp_check_error}
                  </p>
                )}
              </div>

              {/* Coordonnées */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800/80">
                <div>
                  <span className="text-[10px] text-slate-500 block">Entreprise</span>
                  <span className="font-semibold text-slate-200">{selectedContactDetail.company_name || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Profession</span>
                  <span className="font-semibold text-slate-200">{selectedContactDetail.profession || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Ville</span>
                  <span className="font-semibold text-slate-200">{selectedContactDetail.city || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">E-mail</span>
                  <span className="font-semibold text-slate-200">{selectedContactDetail.email || '—'}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelectedContactDetail(null)}
                className="px-3.5 py-1.5 bg-slate-800 text-slate-300 rounded-xl cursor-pointer"
              >
                Fermer
              </button>
              {onOpenConversation && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenConversation(selectedContactDetail.phone);
                    setSelectedContactDetail(null);
                  }}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-md cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Ouvrir Conversation</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMATION SUPPRESSION */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 text-rose-400">
              <Trash2 className="w-4 h-4 text-rose-400" />
              Confirmer la suppression
            </h3>
            <p className="text-xs text-slate-400 mt-2">
              {deleteModal.type === 'single' ? (
                <>
                  Êtes-vous sûr de vouloir supprimer définitivement le contact <strong>{deleteModal.contactName}</strong> du CRM ?
                </>
              ) : (
                <>
                  Les <strong>{deleteModal.count}</strong> contacts sélectionnés seront définitivement retirés de la base de données CRM et des listes d'audience.
                </>
              )}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDeleteModal({ isOpen: false, type: 'single' })}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleExecuteDelete}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold transition-all shadow-md cursor-pointer"
              >
                Confirmer la suppression
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPORTATION EN MASSE */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-5 shadow-2xl animate-in zoom-in-95 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Upload className="w-4 h-4 text-emerald-400" />
                Importation en masse de contacts dans le CRM
              </h3>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick action: Sync from existing Lead Extractor leads */}
            <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-emerald-200">Synchroniser depuis les Leads existants</div>
                <div className="text-[11px] text-emerald-400/80">
                  Transférer instantanément tous les leads extraits dans la base CRM centrale.
                </div>
              </div>
              <button
                onClick={handleSyncLeads}
                disabled={isImporting}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
              >
                {isImporting ? 'Sync en cours...' : 'Synchroniser'}
              </button>
            </div>

            {/* Paste or Upload contacts */}
            <div className="space-y-2">
              <label className="text-[11px] text-slate-300 font-bold block">
                Coller des numéros ou liste CSV (Format : Téléphone, Nom, Entreprise, Ville) :
              </label>
              <textarea
                rows={6}
                value={importPasteText}
                onChange={(e) => setImportPasteText(e.target.value)}
                placeholder={`21698123456, Maître Ben Amor, Cabinet Avocats, Tunis\n21650123456, Dr Ben Salem, Clinique, Sousse\n21622334455, Société Informatique, Tunis`}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            {importNotice && (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200">
                {importNotice}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-xl font-semibold cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={!importPasteText.trim() || isImporting}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-xl transition-all cursor-pointer"
              >
                {isImporting ? 'Importation...' : 'Importer dans le CRM'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NOUVEAU CONTACT INDIVIDUEL */}
      {isNewContactModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                Ajouter un contact au CRM
              </h3>
              <button
                onClick={() => setIsNewContactModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveContact} className="space-y-3 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Téléphone WhatsApp *</label>
                <input
                  type="text"
                  placeholder="+216 98 123 456"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Civilité</label>
                  <select
                    value={formData.civility}
                    onChange={(e) => setFormData({ ...formData, civility: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200"
                  >
                    <option value="Non spécifié">Non spécifié</option>
                    <option value="Monsieur">Monsieur</option>
                    <option value="Madame">Madame</option>
                    <option value="Maître">Maître</option>
                    <option value="Docteur">Docteur</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Statut</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200"
                  >
                    <option value="PROSPECT">Prospect</option>
                    <option value="LEAD">Lead</option>
                    <option value="CLIENT">Client</option>
                    <option value="RELANCE">À relancer</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Prénom</label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Nom</label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Entreprise</label>
                <input
                  type="text"
                  placeholder="Cabinet, Société..."
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Profession</label>
                  <input
                    type="text"
                    placeholder="Avocat, Gérant..."
                    value={formData.profession}
                    onChange={(e) => setFormData({ ...formData, profession: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Ville</label>
                  <input
                    type="text"
                    placeholder="Tunis, Sousse..."
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewContactModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-sm cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
