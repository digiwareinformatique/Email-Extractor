import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, AlertCircle, Trash2, Edit2, Check, X, 
  Download, Eye, Sparkles, Sliders, CheckCircle2, HelpCircle, 
  Search, RefreshCw, Layers, ArrowRight, User, Mail, ShieldAlert,
  ChevronDown, ChevronUp, Database, HelpCircle as InfoIcon, FileSpreadsheet,
  HardDrive, Bookmark, Save, History, FolderOpen,
  CheckSquare, Square, MinusSquare, ListChecks, MessageCircle, Send, MessageSquare,
  CloudUpload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ContactRecord, ExtractionStats, ExtractionResult, FileAnalysis } from './types';
import { exportToCSV, exportToExcel, formatBytes } from './utils';
import { MemoryManager } from './components/MemoryManager';
import { PageRangeSelectorModal } from './components/PageRangeSelectorModal';
import { WhatsAppExtractorView } from './components/WhatsAppExtractorView';
import { LeadExtractorView } from './components/lead-extractor/LeadExtractorView';
import { WhatsAppSenderView } from './components/sender/WhatsAppSenderView';
import { DigiWareBusinessCenterView } from './components/business-center/DigiWareBusinessCenterView';
import { TransferToSenderModal, TransferTargetContact } from './components/sender/TransferToSenderModal';
import { AiConfigModal } from './components/AiConfigModal';
import { leadApi } from './services/leadApi';
import { 
  SavedSession, 
  loadCurrentSession, 
  saveCurrentSession, 
  clearCurrentSession, 
  getSavedSessions 
} from './memory';

interface LoadedFile {
  name: string;
  size: number;
  content: string;
  status: 'pending' | 'success' | 'error';
}

export default function App() {
  // Mother Application Active Module: 5 Connected Engines with Business Center as Primary
  const [activeModule, setActiveModule] = useState<'business_center' | 'email' | 'whatsapp' | 'leads' | 'sender'>(() => {
    try {
      const saved = localStorage.getItem('extractor_active_module');
      if (saved === 'business_center' || saved === 'email' || saved === 'whatsapp' || saved === 'leads' || saved === 'sender') return saved as any;
    } catch (e) {
      // Ignore
    }
    return 'business_center';
  });

  const handleSwitchModule = (mod: 'business_center' | 'email' | 'whatsapp' | 'leads' | 'sender') => {
    setActiveModule(mod);
    try {
      localStorage.setItem('extractor_active_module', mod);
    } catch (e) {
      // Ignore
    }
  };

  // Cross-Module Transfer state to WhatsApp Sender
  const [transferModal, setTransferModal] = useState<{
    isOpen: boolean;
    contacts: TransferTargetContact[];
    sourceName: string;
  }>({
    isOpen: false,
    contacts: [],
    sourceName: ''
  });

  const handleOpenTransferToSender = (contacts: TransferTargetContact[], sourceName: string) => {
    setTransferModal({
      isOpen: true,
      contacts,
      sourceName
    });
  };

  const handleTransferToLeads = async (items: any[], sourceModule: 'whatsapp' | 'email') => {
    try {
      const res = await leadApi.transferContacts(items, sourceModule);
      handleSwitchModule('leads');
      setMemoryRestoredBanner(`${res.addedCount} contacts ont été transférés avec succès vers DigiWare Lead Extractor.`);
      setTimeout(() => setMemoryRestoredBanner(null), 4000);
    } catch (err: any) {
      console.error('Transfer failed:', err);
    }
  };

  // State for active tab in Email Extractor: 'workspace' | 'results' | 'architecture'
  const [activeTab, setActiveTab] = useState<'workspace' | 'results' | 'architecture'>('workspace');
  
  // Settings
  const [aiEnhancement, setAiEnhancement] = useState<boolean>(true);
  const [filterSystemEmails, setFilterSystemEmails] = useState<boolean>(true);
  
  // Workspace inputs
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<LoadedFile[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extraction results state
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [stats, setStats] = useState<ExtractionStats | null>(null);
  const [fileAnalysis, setFileAnalysis] = useState<FileAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Configuration from server
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);
  const [activeAiProvider, setActiveAiProvider] = useState<string>('gemini-default');
  const [activeAiModel, setActiveAiModel] = useState<string>('gemini-3.8-flash');

  // Results display state (Search, Filters, Pagination, Inline edit, Context visualizer)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [confidenceFilter, setConfidenceFilter] = useState<'All' | 'High' | 'Medium' | 'Low'>('All');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);

  // Pagination and export scope states
  const [itemsPerPage, setItemsPerPage] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [exportScope, setExportScope] = useState<'all' | 'page' | 'selected'>('all');

  // Multi-page selection states
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [isPageRangeModalOpen, setIsPageRangeModalOpen] = useState<boolean>(false);

  // Memory management states
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState<boolean>(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [memoryRestoredBanner, setMemoryRestoredBanner] = useState<string | null>(null);

  // Reset currentPage when filters or items per page change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, confidenceFilter, itemsPerPage]);

  // Load saved sessions & restore previous workspace state from local memory on mount
  useEffect(() => {
    // 1. Fetch saved project snapshots
    const sessions = getSavedSessions();
    setSavedSessions(sessions);

    // 2. Auto-restore active session if present
    const restored = loadCurrentSession();
    if (restored) {
      let restoredCount = 0;
      if (restored.contacts && restored.contacts.length > 0) {
        setContacts(restored.contacts);
        setStats(restored.stats || null);
        setFileAnalysis(restored.fileAnalysis || null);
        setActiveTab('results');
        restoredCount = restored.contacts.length;
      }
      if (restored.uploadedFiles && restored.uploadedFiles.length > 0) {
        setUploadedFiles(restored.uploadedFiles);
      }
      if (restored.rawPasteText && restored.rawPasteText.trim()) {
        setRawPasteText(restored.rawPasteText);
      }

      if (restoredCount > 0 || (restored.uploadedFiles && restored.uploadedFiles.length > 0)) {
        setMemoryRestoredBanner(
          `Mémoire restaurée : Travail précédent chargé automatiquement (${restoredCount} contacts, ${restored.uploadedFiles?.length || 0} fichiers).`
        );
      }
    }
  }, []);

  // Auto-save workspace & results to localStorage whenever they change
  useEffect(() => {
    // Save current active state to browser memory
    if (uploadedFiles.length > 0 || contacts.length > 0 || rawPasteText.trim().length > 0) {
      saveCurrentSession({
        uploadedFiles,
        rawPasteText,
        contacts,
        stats,
        fileAnalysis
      });
    }
  }, [uploadedFiles, rawPasteText, contacts, stats, fileAnalysis]);

  // Fetch API key status & active AI provider on mount
  const refreshAiConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const text = await res.text();
      if (!text || text.trim().startsWith('<')) {
        setIsLoadingConfig(false);
        return;
      }
      const data = JSON.parse(text);
      setHasApiKey(data.hasApiKey);
      if (data.activeProvider) setActiveAiProvider(data.activeProvider);
      if (data.activeModel) setActiveAiModel(data.activeModel);
      setIsLoadingConfig(false);
    } catch (err) {
      console.warn('Chargement de la configuration initialisé en mode standard.');
      setIsLoadingConfig(false);
    }
  };

  useEffect(() => {
    refreshAiConfig();
  }, []);

  // Set default raw paste text for a quick tutorial
  useEffect(() => {
    setRawPasteText(
`EXEMPLE DE DOCUMENT BRUITÉ :

De: Jean-Pierre Dupont <jp.dupont@entreprise.fr>
Date: 12 Mars 2026 14:32:10 CET
Sujet: Offre commerciale de partenariat

Bonjour l'équipe,
Je voulais vous présenter notre nouveau projet. Vous pouvez me joindre par téléphone au 01.44.55.66.77 ou par mail à l'adresse jp.dupont@entreprise.fr.

Cordialement,
Jean-Pierre Dupont
Directeur Commercial - Entreprise SAS
--------------------------------------------------

SOCIETE GENERALE SERVICE LOGISTIQUE:
Contact technique principal:
Sophie Martin
Responsable réseaux
s.martin@slog.com (Urgent)

Service support d'alerte générale (ne pas répondre): support@slog.com
Site web: www.slog.com/help
--------------------------------------------------

Réseaux Sociaux et commentaires libres:
"Super initiative !" - @alex_runner32
Marie-Luce Bernard (ml.bernard@gmail.com) a partagé votre post.

Note: contactez également info@entreprise.fr pour les questions de facturation.
`
    );
  }, []);

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  };

  const processFiles = (fileList: FileList) => {
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      
      // Handle different encodings (UTF-8 by default, fallback to ISO-8859-1 for classic Windows files)
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setUploadedFiles(prev => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            content: text,
            status: 'success'
          }
        ]);
      };
      
      reader.onerror = () => {
        setUploadedFiles(prev => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            content: '',
            status: 'error'
          }
        ]);
      };

      reader.readAsText(file, 'UTF-8');
    });
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearWorkspace = () => {
    setUploadedFiles([]);
    setRawPasteText('');
    setContacts([]);
    setSelectedContactIds(new Set());
    setStats(null);
    setFileAnalysis(null);
    setErrorMessage(null);
    setMemoryRestoredBanner(null);
    clearCurrentSession();
  };

  const handleLoadSession = (session: SavedSession) => {
    setUploadedFiles(session.uploadedFiles || []);
    setRawPasteText(session.rawPasteText || '');
    setContacts(session.contacts || []);
    setStats(session.stats || null);
    setFileAnalysis(session.fileAnalysis || null);
    if (session.contacts && session.contacts.length > 0) {
      setActiveTab('results');
    } else {
      setActiveTab('workspace');
    }
    setMemoryRestoredBanner(`Sauvegarde "${session.name}" chargée (${session.contacts.length} contacts).`);
  };

  // Perform Extract
  const handleExtract = async () => {
    setErrorMessage(null);
    
    // Check if we have input
    let combinedText = '';
    let fileName = '';
    let fileSize = 0;

    if (uploadedFiles.length > 0) {
      combinedText = uploadedFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}`).join('\n\n');
      fileName = uploadedFiles.length === 1 ? uploadedFiles[0].name : `${uploadedFiles.length} fichiers combinés`;
      fileSize = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
    } else if (rawPasteText.trim()) {
      combinedText = rawPasteText;
      fileName = 'texte_copie.txt';
      fileSize = new Blob([rawPasteText]).size;
    } else {
      setErrorMessage("Veuillez importer au moins un fichier ou coller du texte brut à analyser.");
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: combinedText,
          fileName,
          fileSize,
          aiEnhancement: aiEnhancement && hasApiKey,
          filterSystemEmails
        })
      });

      if (!response.ok) {
        throw new Error(`Erreur serveur (${response.status})`);
      }

      const result: ExtractionResult = await response.json();
      
      setContacts(result.contacts);
      setStats(result.stats);
      setFileAnalysis(result.fileAnalysis || null);
      setActiveTab('results'); // Switch tab to view results instantly
      setSearchQuery('');
      setConfidenceFilter('All');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Une erreur de communication est survenue avec le moteur d'extraction.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Inline edit handlers
  const startEditing = (contact: ContactRecord) => {
    setEditingContactId(contact.id);
    setEditingName(contact.name);
  };

  const saveEditing = (contactId: string) => {
    const updatedContacts = contacts.map(c => {
      if (c.id === contactId) {
        return { ...c, name: editingName, isEdited: true };
      }
      return c;
    });
    setContacts(updatedContacts);
    recomputeStats(updatedContacts);
    setEditingContactId(null);
  };

  const cancelEditing = () => {
    setEditingContactId(null);
  };

  const deleteContact = (contactId: string) => {
    const updatedContacts = contacts.filter(c => c.id !== contactId);
    setContacts(updatedContacts);
    recomputeStats(updatedContacts);
  };

  const recomputeStats = (updatedList: ContactRecord[]) => {
    if (!stats) return;
    const high = updatedList.filter(c => c.confidenceLevel === 'High').length;
    const med = updatedList.filter(c => c.confidenceLevel === 'Medium').length;
    const low = updatedList.filter(c => c.confidenceLevel === 'Low').length;
    const avgScore = updatedList.length > 0 
      ? Math.round(updatedList.reduce((sum, c) => sum + c.confidenceScore, 0) / updatedList.length) 
      : 0;

    setStats({
      ...stats,
      totalRecordsFound: updatedList.length,
      highConfidenceCount: high,
      mediumConfidenceCount: med,
      lowConfidenceCount: low,
      averageScore: avgScore
    });
  };

  // Filter contacts based on query and confidence filter tab
  const filteredContacts = contacts.filter(c => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.sourceFile.toLowerCase().includes(searchQuery.toLowerCase());
      
    if (confidenceFilter === 'All') return matchesSearch;
    return matchesSearch && c.confidenceLevel === confidenceFilter;
  });

  // Pagination calculations
  const totalItems = filteredContacts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const paginatedContacts = filteredContacts.slice(startIndex, endIndex);

  // Multi-page Selection Helpers
  const toggleSelectContact = (id: string) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setExportScope('selected');
  };

  const isCurrentPageFullySelected = paginatedContacts.length > 0 && paginatedContacts.every(c => selectedContactIds.has(c.id));
  const isCurrentPagePartiallySelected = paginatedContacts.some(c => selectedContactIds.has(c.id)) && !isCurrentPageFullySelected;

  const toggleSelectCurrentPage = () => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (isCurrentPageFullySelected) {
        paginatedContacts.forEach(c => next.delete(c.id));
      } else {
        paginatedContacts.forEach(c => next.add(c.id));
      }
      return next;
    });
    setExportScope('selected');
  };

  const selectAllFiltered = () => {
    const next = new Set<string>();
    filteredContacts.forEach(c => next.add(c.id));
    setSelectedContactIds(next);
    setExportScope('selected');
  };

  const clearSelection = () => {
    setSelectedContactIds(new Set());
    setExportScope('all');
  };

  const handleSelectRange = (startPage: number, endPage: number, mode: 'add' | 'replace' | 'remove') => {
    const validStart = Math.max(1, Math.min(startPage, totalPages));
    const validEnd = Math.max(validStart, Math.min(endPage, totalPages));
    
    const rangeStartIndex = (validStart - 1) * itemsPerPage;
    const rangeEndIndex = Math.min(validEnd * itemsPerPage, filteredContacts.length);
    const contactsInRange = filteredContacts.slice(rangeStartIndex, rangeEndIndex);

    setSelectedContactIds(prev => {
      const next = mode === 'replace' ? new Set<string>() : new Set(prev);
      if (mode === 'remove') {
        contactsInRange.forEach(c => next.delete(c.id));
      } else {
        contactsInRange.forEach(c => next.add(c.id));
      }
      return next;
    });
    setExportScope('selected');
  };

  // Contacts list matching active selection
  const selectedContactsList = filteredContacts.filter(c => selectedContactIds.has(c.id));

  // Count distinct pages containing selected items
  const pagesWithSelection = new Map<number, number>();
  filteredContacts.forEach((c, idx) => {
    if (selectedContactIds.has(c.id)) {
      const pageNum = Math.floor(idx / itemsPerPage) + 1;
      pagesWithSelection.set(pageNum, (pagesWithSelection.get(pageNum) || 0) + 1);
    }
  });
  const selectedPagesCount = pagesWithSelection.size;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-slate-200">
      
      {/* MOTHER APPLICATION HEADER BAR */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-4 md:px-6 py-3 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="bg-slate-950 text-white p-2.5 rounded-lg flex items-center justify-center shadow-md">
              <Database className="w-6 h-6" id="logo-icon" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  EXTRACTOR
                </h1>
                <span className="text-xs font-mono font-medium px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full border border-slate-200/60">
                  Plateforme
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">Plateforme unifiée d'extraction de données & d'intelligence de contact</p>
            </div>
          </div>

          {/* PARALLEL MODULE SELECTOR (Mother App Switcher) */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80 shadow-2xs flex-wrap gap-1">
            <button
              onClick={() => handleSwitchModule('business_center')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeModule === 'business_center'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900 bg-white/60 hover:bg-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>WhatsApp Business Center</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                activeModule === 'business_center' ? 'bg-emerald-800 text-white' : 'bg-emerald-100 text-emerald-800'
              }`}>
                ⭐ Flagship
              </span>
            </button>

            <button
              onClick={() => handleSwitchModule('email')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeModule === 'email'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Mail className="w-3.5 h-3.5 text-indigo-600" />
              <span>Email Extractor</span>
            </button>

            <button
              onClick={() => handleSwitchModule('whatsapp')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeModule === 'whatsapp'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>WhatsApp Extractor</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                activeModule === 'whatsapp' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800'
              }`}>
                +216
              </span>
            </button>

            <button
              onClick={() => handleSwitchModule('leads')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeModule === 'leads'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Lead Extractor</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                activeModule === 'leads' ? 'bg-indigo-600 text-white' : 'bg-indigo-100 text-indigo-800'
              }`}>
                DigiWare
              </span>
            </button>

            <button
              onClick={() => handleSwitchModule('sender')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeModule === 'sender'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>WhatsApp Business Sender</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                activeModule === 'sender' ? 'bg-emerald-800 text-white' : 'bg-emerald-100 text-emerald-800'
              }`}>
                ⚡ Sync & Envoi
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3 self-start lg:self-auto flex-wrap">
            {/* AI Provider & Quota Management Trigger */}
            <button
              type="button"
              onClick={() => setIsAiModalOpen(true)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs hover:opacity-95 active:scale-98 ${
                isLoadingConfig 
                  ? 'bg-slate-50 text-slate-400 border-slate-200' 
                  : activeAiProvider === 'disabled'
                    ? 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                    : hasApiKey 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100/80' 
                      : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100/80'
              }`}
              title="Gérer le moteur d'IA et préserver votre quota Google AI Studio"
            >
              {isLoadingConfig ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : activeAiProvider === 'disabled' ? (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                  <span>Mode 0 Quota (Local)</span>
                  <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold ml-0.5">
                    Changer
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    {activeAiProvider === 'gemini-default' 
                      ? 'IA : Gemini Flash (Défaut)'
                      : activeAiProvider === 'groq'
                        ? 'IA : Groq (Llama 3.3)'
                        : activeAiProvider === 'deepseek'
                          ? 'IA : DeepSeek V3'
                          : activeAiProvider === 'openai'
                            ? `IA : OpenAI (${activeAiModel.split('-')[0] || 'gpt-4o'})`
                            : activeAiProvider === 'custom-openai'
                              ? 'IA : Serveur Local'
                              : `IA : ${activeAiProvider.replace('gemini-', 'Gemini ')}`}
                  </span>
                  <span className="text-[10px] bg-emerald-200/80 text-emerald-900 px-1.5 py-0.5 rounded font-mono font-bold ml-0.5">
                    Gérer
                  </span>
                </>
              )}
            </button>

            {/* Download Project ZIP Archive */}
            <a
              href="/api/download-project-zip"
              download="whatsapp-sender-project.zip"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
              title="Télécharger l'intégralité du code source du projet en archive .zip"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              <span>Télécharger (.zip)</span>
            </a>

            {/* If Email Module is active, show its memory button & tabs */}
            {activeModule === 'email' && (
              <>
                <button
                  onClick={() => setIsMemoryModalOpen(true)}
                  className="bg-slate-900 text-white hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer border border-slate-800"
                  title="Gérer la mémoire et les sauvegardes locales"
                >
                  <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Mémoire</span>
                  <span className="bg-slate-800 text-slate-300 font-mono text-[10px] px-1.5 py-0.5 rounded-full">
                    {savedSessions.length}
                  </span>
                </button>
                
                <nav className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/80">
                  <button 
                    id="tab-workspace"
                    onClick={() => setActiveTab('workspace')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      activeTab === 'workspace' 
                        ? 'bg-white text-slate-900 shadow-xs' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Espace de travail
                  </button>
                  <button 
                    id="tab-results"
                    onClick={() => {
                      if (contacts.length > 0) setActiveTab('results');
                    }}
                    disabled={contacts.length === 0}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      contacts.length === 0 
                        ? 'text-slate-400 cursor-not-allowed' 
                        : activeTab === 'results' 
                          ? 'bg-white text-slate-900 shadow-xs' 
                          : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Résultats ({contacts.length})
                  </button>
                  <button 
                    id="tab-architecture"
                    onClick={() => setActiveTab('architecture')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      activeTab === 'architecture' 
                        ? 'bg-white text-slate-900 shadow-xs' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Méthodologie
                  </button>
                </nav>
              </>
            )}

          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        {activeModule === 'business_center' ? (
          <DigiWareBusinessCenterView />
        ) : activeModule === 'sender' ? (
          <WhatsAppSenderView />
        ) : activeModule === 'leads' ? (
          <LeadExtractorView 
            onTransferToSender={(targets) => handleOpenTransferToSender(targets, 'DigiWare Leads')}
          />
        ) : activeModule === 'whatsapp' ? (
          <WhatsAppExtractorView 
            hasApiKey={hasApiKey} 
            onTransferToLeadExtractor={(items) => handleTransferToLeads(items, 'whatsapp')} 
            onTransferToSender={(contacts) => handleOpenTransferToSender(
              contacts.map(c => ({ phone: c.phone, name: c.name, id: c.id })),
              'WhatsApp Extractor'
            )}
          />
        ) : (
          <>
        
        {/* BANNER NOTIFICATION MEMORY RESTORED */}
        <AnimatePresence>
          {memoryRestoredBanner && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 p-4 bg-slate-900 text-white rounded-xl flex items-center justify-between gap-3 shadow-md border border-slate-800"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-800 text-emerald-400 rounded-lg shrink-0">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div className="text-xs">
                  <span className="font-bold text-slate-100 block">Mémoire Locale Active</span>
                  <p className="text-slate-300 font-medium">{memoryRestoredBanner}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsMemoryModalOpen(true)}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-lg transition-all cursor-pointer shadow-xs"
                >
                  Gérer la mémoire
                </button>
                <button
                  onClick={() => setMemoryRestoredBanner(null)}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                  title="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* BANNER NOTIFICATION IF NO GEMINI KEY */}
        <AnimatePresence>
          {!isLoadingConfig && !hasApiKey && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 text-amber-800"
            >
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
              <div className="text-xs space-y-1">
                <span className="font-semibold block text-amber-900">Moteur en mode Heuristique Local</span>
                <p>
                  Pour activer l'optimisation par Intelligence Artificielle (qui réassocie les blocs bruités et corrige les noms inconnus), configurez la clé <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[11px]">GEMINI_API_KEY</code> dans vos secrets d'application.
                  Le parser heuristique ultra-rapide par défaut reste 100% opérationnel !
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* TAB 1: WORKSPACE */}
        {activeTab === 'workspace' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Input area (8 columns) */}
            <div className="lg:col-span-8 space-y-6">
              
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-4 bg-slate-50/55 flex justify-between items-center flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-500" />
                    <h3 className="font-semibold text-sm text-slate-800">Source d'importation des documents</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsMemoryModalOpen(true)}
                      className="text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
                      Mémoire ({savedSessions.length})
                    </button>
                    { (uploadedFiles.length > 0 || rawPasteText.trim() || contacts.length > 0) && (
                      <button 
                        onClick={clearWorkspace}
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-1.5 px-2.5 py-1 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Vider l'espace
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Option Tabs: File upload or Direct text paste */}
                  <div className="flex gap-4 border-b border-slate-100 pb-3 text-xs font-semibold">
                    <span className="text-slate-900 border-b-2 border-slate-900 pb-3 px-1 cursor-default flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      Documents à analyser et texte libre
                    </span>
                  </div>

                  {/* Drag and Drop Zone */}
                  <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                      isDragging 
                        ? 'border-slate-950 bg-slate-100/50 scale-[0.99]' 
                        : 'border-slate-200 hover:border-slate-400 bg-slate-50/30'
                    }`}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      multiple
                      accept=".txt,.html,.csv,.log,.json"
                      className="hidden" 
                    />
                    <div className="bg-white p-3 rounded-full shadow-xs border border-slate-100">
                      <Upload className="w-6 h-6 text-slate-600" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-800">Glissez-déposez vos fichiers ici, ou cliquez pour parcourir</p>
                      <p className="text-[11px] text-slate-400 font-medium">Prend en charge TXT, HTML, CSV, LOG, JSON (Max 50Mo par fichier)</p>
                    </div>
                  </div>

                  {/* List of imported files */}
                  <AnimatePresence>
                    {uploadedFiles.length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-2 max-h-48 overflow-y-auto pt-2"
                      >
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Fichiers importés ({uploadedFiles.length})</h4>
                        {uploadedFiles.map((file, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-100 text-xs">
                            <div className="flex items-center gap-2 truncate">
                              <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                              <span className="font-medium text-slate-700 truncate">{file.name}</span>
                              <span className="text-[10px] text-slate-400 font-mono">({formatBytes(file.size)})</span>
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFile(idx);
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-slate-100 transition-all"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Manual paste alternative area */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Ou collez du texte directement ici</label>
                      {rawPasteText && (
                        <button 
                          onClick={() => setRawPasteText('')}
                          className="text-[10px] font-semibold text-slate-400 hover:text-rose-600"
                        >
                          Effacer le texte
                        </button>
                      )}
                    </div>
                    <textarea 
                      placeholder="Collez des emails, des signatures de mails, des logs d'interface ou du texte en vrac pour en extraire les coordonnées..."
                      value={rawPasteText}
                      onChange={(e) => setRawPasteText(e.target.value)}
                      rows={8}
                      className="w-full text-xs font-mono p-3 bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:ring-1 focus:ring-slate-950 focus:border-slate-950 outline-none transition-all resize-y"
                    />
                  </div>

                </div>
              </div>

              {/* Error messages display */}
              <AnimatePresence>
                {errorMessage && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex gap-3 text-rose-800 text-xs font-medium"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <div>
                      <span className="font-semibold text-rose-900 block">Erreur de traitement</span>
                      <p className="mt-0.5">{errorMessage}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Start extraction button */}
              <button
                onClick={handleExtract}
                disabled={isAnalyzing}
                className="w-full bg-slate-950 text-white font-semibold rounded-xl py-4 flex items-center justify-center gap-2 hover:bg-slate-900 focus:ring-2 focus:ring-offset-2 focus:ring-slate-950 outline-none shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed transition-all text-sm cursor-pointer"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>ANALYSE DES DOCUMENTS EN COURS (PIPELINE ACTIF)...</span>
                  </>
                ) : (
                  <>
                    <Sliders className="w-5 h-5" />
                    <span>LANCER L'EXTRACTION DES CONTACTS</span>
                  </>
                )}
              </button>

            </div>

            {/* Side column settings (4 columns) */}
            <div className="lg:col-span-4 space-y-6">
              
              <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-4 bg-slate-50/55">
                  <h3 className="font-semibold text-sm text-slate-800">Paramètres d'extraction</h3>
                </div>
                <div className="p-5 space-y-5">
                  
                  {/* AI Toggle */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 block">Optimisation IA (Gemini)</span>
                      <div className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={aiEnhancement && hasApiKey} 
                          disabled={!hasApiKey}
                          onChange={(e) => setAiEnhancement(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-950 peer-disabled:bg-slate-100 peer-disabled:after:bg-slate-300"></div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Utilise l'intelligence artificielle pour corriger les noms coupés ou manquants à partir du contexte brut. Désactivé automatiquement si aucune clé d'API n'est configurée.
                    </p>
                  </div>

                  <hr className="border-slate-100" />

                  {/* Spam Filtering Toggle */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 block">Filtrer les emails système</span>
                      <div className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={filterSystemEmails} 
                          onChange={(e) => setFilterSystemEmails(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-slate-950"></div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Exclut automatiquement les adresses système génériques telles que <code className="bg-slate-100 p-0.5 rounded text-[10px] font-mono">support@</code>, <code className="bg-slate-100 p-0.5 rounded text-[10px] font-mono">noreply@</code> ou <code className="bg-slate-100 p-0.5 rounded text-[10px] font-mono">admin@</code> pour ne retenir que les personnes réelles.
                    </p>
                  </div>

                </div>
              </div>

              {/* Statistics widget if existing */}
              {contacts.length > 0 && stats && (
                <div className="bg-slate-900 text-white rounded-xl shadow-md p-5 space-y-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Statistiques de la dernière analyse</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Total Extraits</span>
                      <span className="text-2xl font-bold tracking-tight block mt-1">{stats.totalRecordsFound}</span>
                    </div>
                    <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">Score Moyen</span>
                      <span className="text-2xl font-bold tracking-tight text-emerald-400 block mt-1">{stats.averageScore}%</span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 text-xs">
                    <div className="flex justify-between items-center text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Confiance Élevée
                      </span>
                      <span className="font-mono font-bold">{stats.highConfidenceCount}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-yellow-500"></span> Confiance Moyenne
                      </span>
                      <span className="font-mono font-bold">{stats.mediumConfidenceCount}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span> Confiance Faible
                      </span>
                      <span className="font-mono font-bold">{stats.lowConfidenceCount}</span>
                    </div>
                    <div className="border-t border-slate-800/80 my-2 pt-2 flex justify-between items-center text-slate-400 text-[10px] font-mono">
                      <span>Temps de calcul :</span>
                      <span>{(stats.timeElapsedMs / 1000).toFixed(2)}s</span>
                    </div>
                  </div>

                  <button 
                    onClick={() => setActiveTab('results')}
                    className="w-full bg-white hover:bg-slate-100 text-slate-900 font-semibold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    Voir la liste filtrable
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Information disclaimer box */}
              <div className="p-4 bg-slate-100 border border-slate-200 rounded-xl space-y-2">
                <div className="flex gap-2 items-center text-slate-700">
                  <InfoIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-xs font-semibold">Comment ça fonctionne ?</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Le système scanne le document brut pour identifier les adresses email. Pour chaque email, il analyse une fenêtre de texte environnante afin d'isoler des fiches nominatives à l'aide d'heuristiques avancées de distance, de proximité et de détection de signatures.
                </p>
              </div>

            </div>

          </div>
        )}

        {/* TAB 2: RESULTS */}
        {activeTab === 'results' && (
          <div className="space-y-6">
            
            {/* COMPLEMENTARY SECTION: DOCUMENT COMPREHENSION & STATISTICS */}
            {fileAnalysis && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-slate-900 text-white rounded-lg">
                      <FileText className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-800 tracking-tight">Preuve de Lecture & Analyse Globale du Document</h3>
                      <p className="text-[11px] text-slate-500 font-medium">Métriques d'ingestion et répartition des domaines du fichier source</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200/50 px-3 py-1.5 rounded-lg text-xs font-semibold self-start sm:self-auto">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                    <span>Document Lu et Indexé avec Succès</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* Card 1: Line & Volume Metrics */}
                  <div className="bg-slate-50/50 border border-slate-200/60 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-2">
                      <Layers className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Structure du Document</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lignes Totales</span>
                        <span className="text-lg font-bold text-slate-800 block">{fileAnalysis.totalLines}</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lignes Remplies</span>
                        <span className="text-lg font-bold text-slate-800 block">{fileAnalysis.nonEmptyLines}</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Caractères</span>
                        <span className="text-lg font-bold text-slate-800 block">{fileAnalysis.characterCount.toLocaleString()}</span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lg. Moyenne</span>
                        <span className="text-lg font-bold text-slate-800 block">{fileAnalysis.averageLineLength} car.</span>
                      </div>
                    </div>
                    <div className="pt-2 text-[10px] text-slate-400 border-t border-slate-200/40">
                      Taux de remplissage : <span className="font-semibold text-slate-600">{fileAnalysis.totalLines > 0 ? Math.round((fileAnalysis.nonEmptyLines / fileAnalysis.totalLines) * 100) : 0}%</span> de lignes actives.
                    </div>
                  </div>

                  {/* Card 2: Email & Provider Distributions */}
                  <div className="bg-slate-50/50 border border-slate-200/60 rounded-xl p-4 space-y-4">
                    <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-2">
                      <Mail className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Distribution des Hôtes</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Total E-mails Détectés :</span>
                        <span className="font-mono font-bold text-slate-800">{fileAnalysis.totalEmailsDetected}</span>
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-500">Gmail (@gmail.com)</span>
                          <span className="font-mono font-bold text-slate-700">{fileAnalysis.gmailCount}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-500">Yahoo (@yahoo.*, @ymail.com)</span>
                          <span className="font-mono font-bold text-slate-700">{fileAnalysis.yahooCount}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-500">Outlook/Hotmail/Live (@outlook.*, @hotmail.*)</span>
                          <span className="font-mono font-bold text-slate-700">{fileAnalysis.outlookCount}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-500">Entreprise/Corporate (Domaine propre)</span>
                          <span className="font-mono font-bold text-slate-700">{fileAnalysis.corporateCount}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-slate-500">Autres Webmails (AOL, iCloud, FAI, Proton...)</span>
                          <span className="font-mono font-bold text-slate-700">{fileAnalysis.otherCount}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Domains Leaderboard */}
                  <div className="bg-slate-50/50 border border-slate-200/60 rounded-xl p-4 flex flex-col h-full max-h-[195px]">
                    <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-2 shrink-0">
                      <Database className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Top Domaines Ingestés</span>
                    </div>
                    <div className="overflow-y-auto flex-1 mt-3 pr-1 space-y-2.5 scrollbar-thin">
                      {fileAnalysis.domainCounts.length === 0 ? (
                        <span className="text-slate-400 text-xs italic block text-center py-6">Aucun domaine détecté</span>
                      ) : (
                        fileAnalysis.domainCounts.slice(0, 10).map((d, index) => {
                          const percentage = fileAnalysis.totalEmailsDetected > 0 
                            ? Math.round((d.count / fileAnalysis.totalEmailsDetected) * 100) 
                            : 0;
                          return (
                            <div key={index} className="space-y-1">
                              <div className="flex justify-between items-center text-[11px]">
                                <span className="font-mono font-medium text-slate-600 truncate max-w-[140px]" title={d.domain}>{d.domain}</span>
                                <span className="font-mono font-bold text-slate-800 shrink-0">{d.count} ({percentage}%)</span>
                              </div>
                              <div className="w-full bg-slate-200/60 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className="bg-slate-900 h-full rounded-full transition-all duration-500" 
                                  style={{ width: `${percentage}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                </div>
              </div>
            )}
            
            {/* Action panel & search */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              
              {/* Search & filters */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1 max-w-2xl">
                
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    placeholder="Filtrer par nom, email, fichier..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-950 focus:border-slate-950 transition-all"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0">
                  {(['All', 'High', 'Medium', 'Low'] as const).map((level) => {
                    const label = level === 'All' ? 'Tous' : level === 'High' ? 'Élevé' : level === 'Medium' ? 'Moyen' : 'Faible';
                    const colorClasses = 
                      confidenceFilter === level 
                        ? 'bg-white text-slate-900 shadow-xs' 
                        : 'text-slate-500 hover:text-slate-900';
                    return (
                      <button
                        key={level}
                        onClick={() => setConfidenceFilter(level)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${colorClasses}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

              </div>

              {/* Exports button */}
              <div className="flex flex-wrap items-center gap-3 self-start md:self-auto shrink-0">
                
                {/* Multi-page Range selection button */}
                <button
                  onClick={() => setIsPageRangeModalOpen(true)}
                  className="bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                  title="Sélectionner plusieurs pages à la fois (ex: pages 4 à 7)"
                >
                  <Layers className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Sélectionner pages...</span>
                  {selectedContactIds.size > 0 && (
                    <span className="bg-emerald-600 text-white font-mono text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                      {selectedContactIds.size}
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Portée :</span>
                  <select 
                    value={exportScope}
                    onChange={(e) => setExportScope(e.target.value as 'all' | 'page' | 'selected')}
                    className="bg-slate-50 border border-slate-200 rounded-lg text-xs py-1.5 px-2.5 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-950 focus:border-slate-950"
                  >
                    {selectedContactIds.size > 0 && (
                      <option value="selected">
                        Sélection ({selectedContactIds.size} contacts sur {selectedPagesCount} p.)
                      </option>
                    )}
                    <option value="all">Tout exporter ({filteredContacts.length} fiches)</option>
                    <option value="page" disabled={paginatedContacts.length === 0}>
                      Page actuelle ({paginatedContacts.length} fiches)
                    </option>
                  </select>
                </div>

                <button
                  onClick={() => setIsMemoryModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  title="Sauvegarder cette liste et ses fichiers en mémoire"
                >
                  <Bookmark className="w-3.5 h-3.5 text-emerald-200" />
                  Mémoire
                </button>
                <button
                  onClick={() => {
                    const listToExport = exportScope === 'selected' 
                      ? selectedContactsList 
                      : exportScope === 'page' 
                        ? paginatedContacts 
                        : filteredContacts;
                    exportToCSV(listToExport, `contacts_${exportScope === 'selected' ? `selection_${selectedContactIds.size}` : stats?.fileName || 'extraits'}.csv`);
                  }}
                  className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  CSV
                </button>
                <button
                  onClick={() => {
                    const listToExport = exportScope === 'selected' 
                      ? selectedContactsList 
                      : exportScope === 'page' 
                        ? paginatedContacts 
                        : filteredContacts;
                    exportToExcel(listToExport, `contacts_${exportScope === 'selected' ? `selection_${selectedContactIds.size}` : stats?.fileName || 'extraits'}.xls`);
                  }}
                  className="bg-slate-950 text-white hover:bg-slate-900 px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  Excel
                </button>

                <button
                  onClick={() => {
                    const listToTransfer = exportScope === 'selected' 
                      ? selectedContactsList 
                      : exportScope === 'page' 
                        ? paginatedContacts 
                        : filteredContacts;
                    handleTransferToLeads(listToTransfer, 'email');
                  }}
                  disabled={filteredContacts.length === 0}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  title="Transférer et enrichir dans DigiWare Lead Extractor"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                  Enrichir Leads (DigiWare)
                </button>
              </div>

            </div>

            {/* FLOATING ACTIVE SELECTION BANNER */}
            <AnimatePresence>
              {selectedContactIds.size > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="p-3.5 bg-slate-900 text-white rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md border border-slate-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg shrink-0">
                      <ListChecks className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="font-bold text-xs text-slate-100 flex items-center gap-2">
                        <span>{selectedContactIds.size} contact(s) sélectionné(s)</span>
                        <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30">
                          {selectedPagesCount} page(s) de résultats
                        </span>
                      </span>
                      <p className="text-[11px] text-slate-400 font-medium">
                        Prêt pour export groupé. Naviguez librement d'une page à l'autre sans perdre la sélection.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      onClick={() => setIsPageRangeModalOpen(true)}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all cursor-pointer border border-slate-700 flex items-center gap-1"
                    >
                      <Layers className="w-3.5 h-3.5 text-emerald-400" />
                      Modifier la plage
                    </button>
                    <button
                      onClick={() => {
                        exportToCSV(selectedContactsList, `contacts_selection_${selectedContactIds.size}.csv`);
                      }}
                      className="px-3 py-1.5 bg-white text-slate-900 hover:bg-slate-100 font-bold text-xs rounded-lg transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
                      title="Exporter la sélection au format CSV"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-700" />
                      Exporter CSV ({selectedContactIds.size})
                    </button>
                    <button
                      onClick={() => {
                        exportToExcel(selectedContactsList, `contacts_selection_${selectedContactIds.size}.xls`);
                      }}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-lg transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
                      title="Exporter la sélection au format Excel"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Exporter Excel ({selectedContactIds.size})
                    </button>
                    <button
                      onClick={clearSelection}
                      className="px-2.5 py-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    >
                      Vider
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Contacts Table Grid */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/75 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {/* CHECKBOX HEADER COLUMN */}
                      <th className="px-4 py-4 w-12 text-center">
                        <button
                          onClick={toggleSelectCurrentPage}
                          className="p-1 rounded hover:bg-slate-200/60 text-slate-700 transition-all cursor-pointer inline-flex items-center justify-center"
                          title={isCurrentPageFullySelected ? "Désélectionner cette page" : "Sélectionner tous les contacts de la page"}
                        >
                          {isCurrentPageFullySelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600" />
                          ) : isCurrentPagePartiallySelected ? (
                            <MinusSquare className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
                          )}
                        </button>
                      </th>
                      <th className="px-6 py-4">Nom de contact</th>
                      <th className="px-6 py-4">Adresse E-mail</th>
                      <th className="px-6 py-4">Fiabilité</th>
                      <th className="px-6 py-4">Fichier source</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredContacts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-400 font-medium">
                          <Search className="w-8 h-8 mx-auto mb-2 opacity-30 text-slate-500" />
                          Aucun contact ne correspond à vos critères de recherche.
                        </td>
                      </tr>
                    ) : (
                      paginatedContacts.map((contact) => {
                        const isEditing = editingContactId === contact.id;
                        const isExpanded = expandedContactId === contact.id;
                        const isSelected = selectedContactIds.has(contact.id);
                        
                        // Confidence level badge color
                        const levelBadge = 
                          contact.confidenceLevel === 'High' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' 
                            : contact.confidenceLevel === 'Medium' 
                              ? 'bg-yellow-50 text-yellow-800 border-yellow-200/50' 
                              : 'bg-rose-50 text-rose-700 border-rose-200/50';

                        return (
                          <React.Fragment key={contact.id}>
                            <tr className={`hover:bg-slate-50/50 transition-all ${isSelected ? 'bg-emerald-50/40' : isExpanded ? 'bg-slate-50/40' : ''}`}>
                              
                              {/* CHECKBOX CELL */}
                              <td className="px-4 py-4 text-center">
                                <button
                                  onClick={() => toggleSelectContact(contact.id)}
                                  className="p-1 rounded hover:bg-slate-200/50 text-slate-700 transition-all cursor-pointer inline-flex items-center justify-center"
                                >
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
                                  )}
                                </button>
                              </td>

                              {/* CONTACT NAME CELL */}
                              <td className="px-6 py-4">
                                {isEditing ? (
                                  <div className="flex items-center gap-1">
                                    <input 
                                      type="text"
                                      value={editingName}
                                      onChange={(e) => setEditingName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveEditing(contact.id);
                                        if (e.key === 'Escape') cancelEditing();
                                      }}
                                      className="border border-slate-300 rounded px-2 py-1 focus:ring-1 focus:ring-slate-950 focus:border-slate-950 outline-none w-full font-medium"
                                      autoFocus
                                    />
                                    <button 
                                      onClick={() => saveEditing(contact.id)}
                                      className="p-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={cancelEditing}
                                      className="p-1 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 font-semibold text-slate-800">
                                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span>{contact.name}</span>
                                    {contact.isEdited && (
                                      <span className="text-[9px] font-medium px-1 bg-blue-50 text-blue-600 rounded border border-blue-100">
                                        Modifié
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* EMAIL CELL */}
                              <td className="px-6 py-4 font-mono text-[11px] text-slate-600">
                                <div className="flex items-center gap-2">
                                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span>{contact.email}</span>
                                </div>
                              </td>

                              {/* CONFIDENCE CELL */}
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${levelBadge}`}>
                                    {contact.confidenceLevel === 'High' ? 'Élevé' : contact.confidenceLevel === 'Medium' ? 'Moyen' : 'Faible'}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400">({contact.confidenceScore}%)</span>
                                </div>
                              </td>

                              {/* SOURCE FILE CELL */}
                              <td className="px-6 py-4 text-slate-500 text-[11px] font-medium truncate max-w-xs">
                                {contact.sourceFile}
                              </td>

                              {/* ACTIONS CELL */}
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  
                                  {/* Toggle context button */}
                                  <button
                                    onClick={() => setExpandedContactId(isExpanded ? null : contact.id)}
                                    title="Visualiser le contexte de texte"
                                    className={`p-1.5 rounded-lg border transition-all ${
                                      isExpanded 
                                        ? 'bg-slate-900 border-slate-900 text-white' 
                                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-950'
                                    }`}
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Edit button */}
                                  <button
                                    onClick={() => startEditing(contact)}
                                    title="Corriger le nom manuellement"
                                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950 transition-all"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Delete button */}
                                  <button
                                    onClick={() => deleteContact(contact.id)}
                                    title="Supprimer la fiche"
                                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-rose-500 hover:bg-rose-50 hover:border-rose-200 transition-all"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>

                                </div>
                              </td>

                            </tr>

                            {/* EXPANDED DETAILS / CONTEXT PANEL */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={6} className="bg-slate-50/75 p-5 border-l-2 border-slate-900">
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-start text-[11px]">
                                      <div className="space-y-1">
                                        <h5 className="font-bold text-slate-700">Contexte textuel d'extraction</h5>
                                        <p className="text-slate-400">Position d'apparition d'email d'origine.</p>
                                      </div>
                                      
                                      {/* Scoring explanation list */}
                                      <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-xs max-w-sm space-y-1">
                                        <span className="font-bold text-slate-700 block uppercase text-[9px] tracking-wider mb-1">Détails des Scores</span>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-slate-400">Nom Détecté :</span>
                                            <span className={contact.criteriaScores.nameFound ? 'text-emerald-600 font-bold' : 'text-rose-500 font-semibold'}>
                                              {contact.criteriaScores.nameFound ? 'Oui' : 'Non'}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-slate-400">Domaine Pro :</span>
                                            <span className={contact.criteriaScores.isCorporateDomain ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                                              {contact.criteriaScores.isCorporateDomain ? 'Oui' : 'Non'}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-slate-400">Email Valide :</span>
                                            <span className={contact.criteriaScores.emailValid ? 'text-emerald-600 font-bold' : 'text-rose-500'}>
                                              {contact.criteriaScores.emailValid ? 'Oui' : 'Non'}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-slate-400">Boite Système :</span>
                                            <span className={contact.criteriaScores.hasSpamKeywords ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                                              {contact.criteriaScores.hasSpamKeywords ? 'Oui' : 'Non'}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Raw text quote */}
                                    <div className="bg-white rounded-lg border border-slate-200/80 p-3 shadow-inner font-mono text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed relative">
                                      {contact.rawContext}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              {filteredContacts.length > 0 && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs font-medium text-slate-500">
                  
                  {/* Items per page and status info */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span>Afficher</span>
                      <select
                        value={itemsPerPage}
                        onChange={(e) => {
                          setItemsPerPage(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-950 font-semibold text-slate-800"
                      >
                        {[20, 50, 100, 1000].map(size => (
                          <option key={size} value={size}>{size} lignes</option>
                        ))}
                      </select>
                      <span>par page</span>
                    </div>
                    
                    <span className="text-slate-400 font-normal">
                      Affichage de <span className="font-semibold text-slate-700">{startIndex + 1}</span> à{' '}
                      <span className="font-semibold text-slate-700">{endIndex}</span> sur{' '}
                      <span className="font-semibold text-slate-700">{totalItems}</span> contacts
                    </span>
                  </div>

                  {/* Page selector buttons */}
                  <div className="flex items-center justify-center gap-1">
                    {/* First page */}
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed transition-all font-semibold"
                    >
                      Début
                    </button>
                    
                    {/* Previous page */}
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed transition-all font-semibold"
                    >
                      Précédent
                    </button>

                     {/* Numeric page items with ellipsis */}
                    <div className="hidden md:flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(page => {
                          // Keep first page, last page, current page, and adjacent pages
                          return page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1;
                        })
                        .map((page, index, array) => {
                          const showEllipsisBefore = index > 0 && page - array[index - 1] > 1;
                          
                          // Count how many selected items are on this page
                          const pageStart = (page - 1) * itemsPerPage;
                          const pageEnd = pageStart + itemsPerPage;
                          const pageItems = filteredContacts.slice(pageStart, pageEnd);
                          const selOnPage = pageItems.filter(c => selectedContactIds.has(c.id)).length;

                          return (
                            <React.Fragment key={page}>
                              {showEllipsisBefore && <span className="px-1 text-slate-400">...</span>}
                              <button
                                onClick={() => setCurrentPage(page)}
                                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1 ${
                                  currentPage === page
                                    ? 'bg-slate-950 text-white shadow-xs'
                                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <span>{page}</span>
                                {selOnPage > 0 && (
                                  <span className={`text-[9px] px-1 rounded-full font-mono font-bold ${
                                    currentPage === page ? 'bg-emerald-500 text-slate-950' : 'bg-emerald-100 text-emerald-800'
                                  }`}>
                                    {selOnPage}
                                  </span>
                                )}
                              </button>
                            </React.Fragment>
                          );
                        })}
                    </div>

                    {/* Mobile brief page counter */}
                    <span className="md:hidden px-3 text-slate-600 font-semibold">
                      Page {currentPage} / {totalPages}
                    </span>

                    {/* Next page */}
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed transition-all font-semibold"
                    >
                      Suivant
                    </button>

                    {/* Last page */}
                    <button
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed transition-all font-semibold"
                    >
                      Fin
                    </button>
                  </div>

                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB 3: ARCHITECTURE */}
        {activeTab === 'architecture' && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6 max-w-4xl mx-auto">
            
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-slate-700" />
                Méthodologie & Moteur d'Extraction
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                L'application repose sur un moteur hybride à deux étapes conçu pour une précision maximale et un taux extrêmement faible de faux positifs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-slate-100 text-slate-800 rounded-full flex items-center justify-center text-[10px] font-bold">1</span>
                  Analyse Heuristique Locale (Temps Réel)
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Dès qu'un document est importé, notre parser heuristique natif prend le relais en quelques millisecondes :
                </p>
                <ul className="text-xs text-slate-500 space-y-1.5 pl-4 list-disc">
                  <li><strong>Nettoyage et Normalisation :</strong> Stripping des balises HTML/CSS, gestion des entités et réalignement des lignes.</li>
                  <li><strong>Extraction Régulière :</strong> Isolation des e-mails via expressions régulières RFC conformes.</li>
                  <li><strong>Analyse de Voisinage :</strong> Évaluation d'une fenêtre de 6 lignes pour isoler les signatures, formules de politesse, et structures de lignes proches (ex: <code className="bg-slate-50 p-0.5 rounded text-[10px] font-mono">Sophie Martin &lt;s.martin@...&gt;</code>).</li>
                </ul>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 bg-slate-950 text-white rounded-full flex items-center justify-center text-[10px] font-bold">2</span>
                  Optimisation IA (Gemini API - Optionnel)
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Si l'optimisation est cochée et qu'une clé API est valide, les contacts dont l'association nom-email est incertaine (Score Moyen/Faible) sont transmis en micro-lots au modèle <strong className="font-mono text-[11px]">gemini-flash-latest</strong> :
                </p>
                <ul className="text-xs text-slate-500 space-y-1.5 pl-4 list-disc">
                  <li><strong>Résolution de Contexte :</strong> Correction de l'Inconnu en extrayant le prénom/nom correct dans les signatures ou en-têtes.</li>
                  <li><strong>Validation de Lien :</strong> Confirmation de la cohérence de l'association.</li>
                  <li><strong>Formatage :</strong> Re-capitalisation et nettoyage des préfixes de texte parasite.</li>
                </ul>
              </div>

            </div>

            <hr className="border-slate-100" />

            {/* Confidence metric explain */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Algorithme de Notation et Confiance (0 - 100%)</h4>
              <p className="text-xs text-slate-600">
                La note de confiance affectée à chaque contact extrait est calculée dynamiquement selon des critères rigoureux :
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 text-xs">
                  <span className="font-bold text-emerald-800 block">ÉLEVÉ (75% - 100%)</span>
                  <p className="text-emerald-600 mt-1 leading-normal text-[11px]">
                    Email parfaitement structuré, nom de contact validé et distinct, présent sur la même ligne ou immédiatement adjacent à l'e-mail. Association confirmée.
                  </p>
                </div>
                <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-100 text-xs">
                  <span className="font-bold text-yellow-800 block">MOYEN (45% - 74%)</span>
                  <p className="text-yellow-600 mt-1 leading-normal text-[11px]">
                    Email valide mais nom déduit indirectement (ex: préfixe de l'e-mail), ou bien nom trouvé à plus de 2 lignes de distance sans confirmation explicite.
                  </p>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-100 text-xs">
                  <span className="font-bold text-rose-800 block">FAIBLE (0% - 44%)</span>
                  <p className="text-rose-600 mt-1 leading-normal text-[11px]">
                    Absence totale de nom humain rattachable, e-mail système générique ou suspect, ou distance excessive entre l'information de nom et l'adresse email.
                  </p>
                </div>
              </div>
            </div>

          </div>
        )}
          </>
        )}

      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-6 px-6 text-center text-xs text-slate-400 font-medium">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:justify-between items-center gap-3">
          <p>© 2026 Email Extractor Engine. Développé pour une précision de 95% +.</p>
          <div className="flex gap-4">
            <span className="hover:text-slate-600 cursor-default">Simplicité</span>
            <span>•</span>
            <span className="hover:text-slate-600 cursor-default">Stabilité</span>
            <span>•</span>
            <span className="hover:text-slate-600 cursor-default">Haute Précision</span>
          </div>
        </div>
      </footer>

      {/* PAGE RANGE SELECTOR MODAL */}
      <PageRangeSelectorModal
        isOpen={isPageRangeModalOpen}
        onClose={() => setIsPageRangeModalOpen(false)}
        totalPages={totalPages}
        itemsPerPage={itemsPerPage}
        filteredContacts={filteredContacts}
        selectedContactIds={selectedContactIds}
        onSelectRange={handleSelectRange}
        onSelectAllFiltered={selectAllFiltered}
        onClearSelection={clearSelection}
      />

      {/* MEMORY MANAGER MODAL */}
      <MemoryManager
        isOpen={isMemoryModalOpen}
        onClose={() => setIsMemoryModalOpen(false)}
        currentSession={{
          uploadedFiles,
          rawPasteText,
          contacts,
          stats,
          fileAnalysis
        }}
        savedSessions={savedSessions}
        onLoadSession={handleLoadSession}
        onUpdateSavedSessions={(updated) => setSavedSessions(updated)}
        onClearCurrentSession={clearWorkspace}
      />

      {/* AI PROVIDER & QUOTA MANAGEMENT MODAL */}
      <AiConfigModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        onConfigUpdated={(activeProv, activeMod) => {
          setActiveAiProvider(activeProv);
          setActiveAiModel(activeMod);
          setHasApiKey(activeProv !== 'disabled');
          refreshAiConfig();
        }}
      />

      {/* CROSS-MODULE TRANSFER TO WHATSAPP SENDER MODAL */}
      <TransferToSenderModal
        isOpen={transferModal.isOpen}
        onClose={() => setTransferModal(prev => ({ ...prev, isOpen: false }))}
        contacts={transferModal.contacts}
        sourceModuleName={transferModal.sourceName}
        onNavigateToSender={() => handleSwitchModule('sender')}
      />

    </div>
  );
}
