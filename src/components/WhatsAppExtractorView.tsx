import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, AlertCircle, Trash2, Edit2, Check, X, 
  Download, Eye, Sparkles, Sliders, CheckCircle2, HelpCircle, 
  Search, RefreshCw, Layers, ArrowRight, User, Phone, ShieldAlert,
  ChevronDown, ChevronUp, Database, HelpCircle as InfoIcon, FileSpreadsheet,
  HardDrive, Bookmark, Save, History, FolderOpen, ExternalLink,
  CheckSquare, Square, MinusSquare, ListChecks, MessageCircle, Globe2, Send
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  WhatsAppContactRecord, 
  WhatsAppExtractionStats, 
  WhatsAppExtractionResult, 
  WhatsAppFileAnalysis, 
  TunisianOperator,
  ScriptType 
} from '../types';
import { exportWhatsAppToCSV, exportWhatsAppToExcel, exportWhatsAppToVCF, formatBytes } from '../utils';
import { WhatsAppMemoryManager } from './WhatsAppMemoryManager';
import { 
  SavedWhatsAppSession, 
  loadCurrentWhatsAppSession, 
  saveCurrentWhatsAppSession, 
  clearCurrentWhatsAppSession, 
  getSavedWhatsAppSessions 
} from '../memory';

interface LoadedFile {
  name: string;
  size: number;
  content: string;
  status: 'pending' | 'success' | 'error';
}

interface WhatsAppExtractorViewProps {
  hasApiKey: boolean;
  onTransferToLeadExtractor?: (contacts: WhatsAppContactRecord[]) => void;
  onTransferToSender?: (contacts: WhatsAppContactRecord[]) => void;
}

export const WhatsAppExtractorView: React.FC<WhatsAppExtractorViewProps> = ({ 
  hasApiKey,
  onTransferToLeadExtractor,
  onTransferToSender
}) => {
  // Tabs: 'workspace' | 'results' | 'architecture'
  const [activeTab, setActiveTab] = useState<'workspace' | 'results' | 'architecture'>('workspace');

  // Extraction options
  const [aiEnhancement, setAiEnhancement] = useState<boolean>(true);
  const [filterLandlines, setFilterLandlines] = useState<boolean>(false);
  const [targetOperator, setTargetOperator] = useState<'all' | 'mobile_only' | 'ooredoo' | 'orange' | 'tt' | 'lyca'>('all');

  // Inputs
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<LoadedFile[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Results state
  const [contacts, setContacts] = useState<WhatsAppContactRecord[]>([]);
  const [stats, setStats] = useState<WhatsAppExtractionStats | null>(null);
  const [fileAnalysis, setFileAnalysis] = useState<WhatsAppFileAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Results controls
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [confidenceFilter, setConfidenceFilter] = useState<'All' | 'High' | 'Medium' | 'Low'>('All');
  const [operatorFilter, setOperatorFilter] = useState<string>('All');
  const [scriptFilter, setScriptFilter] = useState<'All' | 'arabic' | 'latin' | 'mixed'>('All');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);

  // Pagination
  const [itemsPerPage, setItemsPerPage] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());

  // Memory
  const [isMemoryModalOpen, setIsMemoryModalOpen] = useState<boolean>(false);
  const [savedSessions, setSavedSessions] = useState<SavedWhatsAppSession[]>([]);
  const [memoryRestoredBanner, setMemoryRestoredBanner] = useState<string | null>(null);

  // Reset page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, confidenceFilter, operatorFilter, scriptFilter, itemsPerPage]);

  // Load saved sessions on mount
  useEffect(() => {
    const sessions = getSavedWhatsAppSessions();
    setSavedSessions(sessions);

    const restored = loadCurrentWhatsAppSession();
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
          `Mémoire WhatsApp restaurée : ${restoredCount} numéros tunisiens chargés automatiquement.`
        );
      }
    }
  }, []);

  // Auto-save active state
  useEffect(() => {
    if (uploadedFiles.length > 0 || contacts.length > 0 || rawPasteText.trim().length > 0) {
      saveCurrentWhatsAppSession({
        uploadedFiles,
        rawPasteText,
        contacts,
        stats,
        fileAnalysis
      });
    }
  }, [uploadedFiles, rawPasteText, contacts, stats, fileAnalysis]);

  // Default sample with realistic bilingual Tunisian text
  const loadDefaultSample = () => {
    setRawPasteText(
`DOCUMENT TEST - EXTRACTION WHATSAPP TUNISIE (BILINGUE) :

=======================================================
ANNONCES ET CONTACTS COMMERCIAUX :
=======================================================

عمر
22 123 456
(Disponible tous les jours pour les livraisons à Sousse et Tunis)

محمد بن علي
50 456 789
مسؤول المبيعات بشركة الأمان - السعر: 150 دينار تونسي

أحمد
98 765 432
الاتصال عبر واتساب مباشرة للاستفسار

-------------------------------------------------------
Omar Trabelsi
+216 22 123 456
Directeur Commercial Ooredoo Business

Mohamed Ali
00216 50 123 456
Contact Orange Tunisie - Support technique WhatsApp

Sonia Ben Salem
Tél: 24 555 666
Email: sonia@domaine.tn

Kais Bouazizi
Gsm: +216 97 888 999
WhatsApp: wa.me/21697888999

-------------------------------------------------------
ÉQUIPE TECHNIQUE & BUREAUX :
-------------------------------------------------------
المهندس كريم الشابي
هاتف: 52 333 444
مكتب تونس العاصمة

سارة الطرابلسي
رقم الجوال: 95 111 222 (واتساب مفعل)

Standard Fixe Grand Tunis (ne pas envoyer de whatsapp):
71 234 567

Faux positifs à ignorer :
Date de réunion: 12/03/2026
Code postal: 1002 Tunis
Numéro de facture: 20260309
`
    );
  };

  // Set default sample on mount if empty
  useEffect(() => {
    if (!rawPasteText.trim() && contacts.length === 0) {
      loadDefaultSample();
    }
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
    clearCurrentWhatsAppSession();
  };

  const handleLoadSession = (session: SavedWhatsAppSession) => {
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
    setMemoryRestoredBanner(`Sauvegarde WhatsApp "${session.name}" chargée (${session.contacts.length} numéros).`);
  };

  // Perform Extract WhatsApp
  const handleExtractWhatsApp = async () => {
    setErrorMessage(null);

    let combinedText = '';
    let fileName = '';
    let fileSize = 0;

    if (uploadedFiles.length > 0) {
      combinedText = uploadedFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}`).join('\n\n');
      fileName = uploadedFiles.length === 1 ? uploadedFiles[0].name : `${uploadedFiles.length} fichiers combinés`;
      fileSize = uploadedFiles.reduce((sum, f) => sum + f.size, 0);
    } else if (rawPasteText.trim()) {
      combinedText = rawPasteText;
      fileName = 'texte_whatsapp.txt';
      fileSize = new Blob([rawPasteText]).size;
    } else {
      setErrorMessage("Veuillez importer au moins un fichier ou coller du texte brut contenant des numéros tunisiens.");
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await fetch('/api/extract-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: combinedText,
          fileName,
          fileSize,
          aiEnhancement: aiEnhancement && hasApiKey,
          filterLandlines,
          targetOperator
        })
      });

      if (!response.ok) {
        throw new Error(`Erreur serveur (${response.status})`);
      }

      const result: WhatsAppExtractionResult = await response.json();
      setContacts(result.contacts);
      setStats(result.stats);
      setFileAnalysis(result.fileAnalysis || null);
      setActiveTab('results');
      setSearchQuery('');
      setConfidenceFilter('All');
      setOperatorFilter('All');
      setScriptFilter('All');
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Une erreur est survenue lors de l'extraction des numéros WhatsApp.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Inline edit handlers
  const startEditing = (contact: WhatsAppContactRecord) => {
    setEditingContactId(contact.id);
    setEditingName(contact.name);
  };

  const saveEditing = (contactId: string) => {
    const updated = contacts.map(c => {
      if (c.id === contactId) {
        return { ...c, name: editingName, isEdited: true };
      }
      return c;
    });
    setContacts(updated);
    setEditingContactId(null);
  };

  const deleteContact = (contactId: string) => {
    const updated = contacts.filter(c => c.id !== contactId);
    setContacts(updated);
    if (stats) {
      const high = updated.filter(c => c.confidenceLevel === 'High').length;
      const med = updated.filter(c => c.confidenceLevel === 'Medium').length;
      const low = updated.filter(c => c.confidenceLevel === 'Low').length;
      const avg = updated.length > 0 ? Math.round(updated.reduce((sum, c) => sum + c.confidenceScore, 0) / updated.length) : 0;
      setStats({
        ...stats,
        totalRecordsFound: updated.length,
        highConfidenceCount: high,
        mediumConfidenceCount: med,
        lowConfidenceCount: low,
        averageScore: avg
      });
    }
  };

  // Filter contacts
  const filteredContacts = contacts.filter(c => {
    const matchesSearch = 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      c.cleanPhone.includes(searchQuery) ||
      c.formattedNational.includes(searchQuery) ||
      c.formattedInternational.includes(searchQuery) ||
      c.operator.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (confidenceFilter !== 'All' && c.confidenceLevel !== confidenceFilter) return false;
    if (operatorFilter !== 'All' && c.operator !== operatorFilter) return false;
    if (scriptFilter !== 'All' && c.scriptType !== scriptFilter) return false;

    return true;
  });

  // Pagination
  const totalItems = filteredContacts.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const paginatedContacts = filteredContacts.slice(startIndex, endIndex);

  // Multi-select
  const toggleSelectContact = (id: string) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isCurrentPageFullySelected = paginatedContacts.length > 0 && paginatedContacts.every(c => selectedContactIds.has(c.id));

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
  };

  const selectAllFiltered = () => {
    const next = new Set<string>();
    filteredContacts.forEach(c => next.add(c.id));
    setSelectedContactIds(next);
  };

  const clearSelection = () => {
    setSelectedContactIds(new Set());
  };

  // Contacts to export
  const contactsToExport = selectedContactIds.size > 0 
    ? filteredContacts.filter(c => selectedContactIds.has(c.id))
    : filteredContacts;

  return (
    <div className="space-y-6">
      
      {/* MODULE HEADER BAR */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-600 text-white rounded-lg flex items-center justify-center shadow-xs">
            <MessageCircle className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">WHATSAPP EXTRACTOR (TUNISIE)</h2>
              <span className="text-[11px] font-mono px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200 font-semibold">
                +216 Spécialiste
              </span>
              <span className="text-[11px] font-medium px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full border border-slate-200">
                Arabe & Latin
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Extraction haute précision : Détection des numéros tunisiens (Ooredoo, Orange, TT, Lyca) et association des noms bilingues
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Memory Modal Button */}
          <button
            onClick={() => setIsMemoryModalOpen(true)}
            className="bg-slate-900 text-white hover:bg-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer border border-slate-800"
          >
            <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mémoire WhatsApp</span>
            <span className="bg-slate-800 text-emerald-300 font-mono text-[10px] px-1.5 py-0.5 rounded-full">
              {savedSessions.length}
            </span>
          </button>

          {/* Module Internal Navigation */}
          <nav className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/80">
            <button
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
              onClick={() => setActiveTab('architecture')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                activeTab === 'architecture'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Méthodologie & Règles TN
            </button>
          </nav>
        </div>
      </div>

      {/* BANNER RESTORED */}
      <AnimatePresence>
        {memoryRestoredBanner && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-emerald-950 text-white rounded-xl flex items-center justify-between gap-3 shadow-md border border-emerald-800"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-900 text-emerald-400 rounded-lg shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div className="text-xs">
                <span className="font-bold text-emerald-100 block">Session WhatsApp Restaurée</span>
                <p className="text-emerald-300 font-medium">{memoryRestoredBanner}</p>
              </div>
            </div>
            <button
              onClick={() => setMemoryRestoredBanner(null)}
              className="p-1 text-emerald-300 hover:text-white hover:bg-emerald-900 rounded-lg transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ERROR MESSAGE */}
      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-3 text-xs">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <div className="flex-1 font-medium">{errorMessage}</div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: WORKSPACE */}
      {/* ========================================================================= */}
      {activeTab === 'workspace' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left 2 Cols: Inputs */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* File Upload Zone */}
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-all bg-white shadow-2xs ${
                isDragging 
                  ? 'border-emerald-500 bg-emerald-50/50' 
                  : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileSelect}
                multiple
                accept=".txt,.csv,.log,.text"
                className="hidden"
              />
              <div className="flex flex-col items-center">
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-full mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">Glissez-déposez des fichiers texte bruts</h3>
                <p className="text-xs text-slate-500 mt-1 mb-4 max-w-md">
                  Fichiers WhatsApp exportés, dumps de forums, annonces Facebook ou listes clients (.txt, .csv)
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-all shadow-xs cursor-pointer"
                >
                  Parcourir mes fichiers
                </button>
              </div>
            </div>

            {/* Uploaded Files List */}
            {uploadedFiles.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-600" />
                    Fichiers Prêts pour l'Extraction ({uploadedFiles.length})
                  </h4>
                  <button 
                    onClick={() => setUploadedFiles([])}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    Tout retirer
                  </button>
                </div>
                <div className="space-y-2">
                  {uploadedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-800 truncate">{file.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">({formatBytes(file.size)})</span>
                      </div>
                      <button 
                        onClick={() => removeFile(idx)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw Text Paste Area */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  Ou collez votre texte brut ici (Arabe ou Français / Latin)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadDefaultSample}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-medium hover:underline"
                  >
                    Exemple bilingue
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    onClick={() => setRawPasteText('')}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Effacer
                  </button>
                </div>
              </div>
              <textarea
                value={rawPasteText}
                onChange={(e) => setRawPasteText(e.target.value)}
                rows={12}
                placeholder="Exemple :&#10;عمر&#10;22 123 456&#10;&#10;محمد بن علي&#10;50 456 789&#10;&#10;Omar Trabelsi&#10;+216 22 123 456"
                className="w-full text-xs font-mono p-3 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-slate-50/50 leading-relaxed"
                dir="auto"
              />
              <div className="flex justify-between items-center mt-2 text-[11px] text-slate-400">
                <span>Supporte les numéros 8 chiffres, +216, 00216, et les chiffres arabes (٠١٢٣٤٥٦٧٨٩)</span>
                <span>{rawPasteText.length} caractères</span>
              </div>
            </div>

          </div>

          {/* Right Col: Options & Launch Card */}
          <div className="space-y-6">
            
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-5">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                <Sliders className="w-4 h-4 text-emerald-600" />
                Paramètres de Détection WhatsApp
              </h3>

              {/* Target Operator Filter */}
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Ciblage Opérateur
                </label>
                <select
                  value={targetOperator}
                  onChange={(e: any) => setTargetOperator(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 font-medium text-slate-800"
                >
                  <option value="all">Tous les opérateurs tunisiens (+216)</option>
                  <option value="mobile_only">Mobiles uniquement (2x, 5x, 9x, 4x)</option>
                  <option value="ooredoo">Ooredoo Tunisie uniquement (2x xx xx xx)</option>
                  <option value="orange">Orange Tunisie uniquement (5x xx xx xx)</option>
                  <option value="tt">Tunisie Telecom uniquement (9x xx xx xx)</option>
                  <option value="lyca">Lycamobile Tunisie uniquement (4x xx xx xx)</option>
                </select>
              </div>

              {/* Landline Exclusion Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-lg">
                <div className="pr-3">
                  <span className="text-xs font-bold text-slate-800 block">Exclure les lignes fixes</span>
                  <p className="text-[11px] text-slate-500">Ignore les numéros commençant par 7x (fixe) et 3x (VoIP)</p>
                </div>
                <input
                  type="checkbox"
                  checked={filterLandlines}
                  onChange={(e) => setFilterLandlines(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded-sm focus:ring-emerald-500 cursor-pointer"
                />
              </div>

              {/* AI Enhancement Toggle */}
              <div className="flex items-center justify-between p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg">
                <div className="pr-3">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-xs font-bold text-emerald-950">Raffinement IA (Gemini Flash)</span>
                  </div>
                  <p className="text-[11px] text-emerald-700">Disambiguïse les annonces complexes bilingues</p>
                </div>
                <input
                  type="checkbox"
                  checked={aiEnhancement}
                  onChange={(e) => setAiEnhancement(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded-sm focus:ring-emerald-500 cursor-pointer"
                />
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <button
                  onClick={handleExtractWhatsApp}
                  disabled={isAnalyzing}
                  className={`w-full py-3 px-4 text-xs font-bold rounded-xl text-white flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer ${
                    isAnalyzing 
                      ? 'bg-slate-400 cursor-not-allowed' 
                      : 'bg-emerald-600 hover:bg-emerald-700 active:scale-98'
                  }`}
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Analyse des numéros tunisiens en cours...</span>
                    </>
                  ) : (
                    <>
                      <MessageCircle className="w-4 h-4" />
                      <span>Lancer l'Extraction WhatsApp</span>
                    </>
                  )}
                </button>

                <button
                  onClick={clearWorkspace}
                  disabled={isAnalyzing}
                  className="w-full py-2 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                >
                  Réinitialiser l'espace de travail
                </button>
              </div>

            </div>

            {/* Quick Helper Box */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2 text-slate-600">
              <span className="font-bold text-slate-800 block flex items-center gap-1.5">
                <InfoIcon className="w-3.5 h-3.5 text-emerald-600" />
                Format tunisien accepté :
              </span>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-500">
                <li><code className="bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-800">22 123 456</code> (National standard)</li>
                <li><code className="bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-800">+216 22 123 456</code> (International)</li>
                <li><code className="bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-800">00216 22 123 456</code> (Format 00)</li>
                <li><code className="bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-800">22123456</code> (Compact 8 chiffres)</li>
                <li>Noms en arabe (<span dir="rtl" className="font-semibold text-slate-800">عمر، محمد، أحمد</span>) ou latins.</li>
              </ul>
            </div>

          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: RESULTS */}
      {/* ========================================================================= */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          
          {/* STATS OVERVIEW CARDS */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Numéros Trouvés</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{stats.totalRecordsFound}</span>
                <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">{stats.timeElapsedMs} ms</span>
              </div>

              <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-2xs bg-emerald-50/20">
                <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider block">Haute Confiance</span>
                <span className="text-2xl font-black text-emerald-700 mt-1 block">{stats.highConfidenceCount}</span>
                <span className="text-[10px] text-emerald-600 font-medium mt-0.5 block">Score ≥ 75%</span>
              </div>

              <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-2xs bg-amber-50/20">
                <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider block">Moyenne Confiance</span>
                <span className="text-2xl font-black text-amber-700 mt-1 block">{stats.mediumConfidenceCount}</span>
                <span className="text-[10px] text-amber-600 font-medium mt-0.5 block">Score 50-74%</span>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Noms en Arabe</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{stats.arabicNamesCount}</span>
                <span className="text-[10px] text-slate-400 font-medium mt-0.5 block">عربي</span>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Noms Latins</span>
                <span className="text-2xl font-black text-slate-900 mt-1 block">{stats.latinNamesCount}</span>
                <span className="text-[10px] text-slate-400 font-medium mt-0.5 block">Français / Latin</span>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Score Moyen</span>
                <span className="text-2xl font-black text-emerald-600 mt-1 block">{stats.averageScore}%</span>
                <span className="text-[10px] text-slate-400 font-medium mt-0.5 block">Indice de qualité</span>
              </div>

            </div>
          )}

          {/* OPERATOR BREAKDOWN BADGES */}
          {fileAnalysis && fileAnalysis.operatorDistribution.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between gap-4 flex-wrap shadow-2xs">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                Répartition des Opérateurs Tunisiens :
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {fileAnalysis.operatorDistribution.map(op => (
                  <span
                    key={op.operator}
                    className={`text-xs px-2.5 py-1 rounded-md font-semibold border ${
                      op.operator === 'Ooredoo' 
                        ? 'bg-rose-50 text-rose-700 border-rose-200' 
                        : op.operator === 'Orange' 
                          ? 'bg-orange-50 text-orange-700 border-orange-200' 
                          : op.operator === 'Tunisie Telecom' 
                            ? 'bg-sky-50 text-sky-700 border-sky-200' 
                            : op.operator === 'Lycamobile' 
                              ? 'bg-purple-50 text-purple-700 border-purple-200' 
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {op.operator} : {op.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* CONTROLS BAR: SEARCH, FILTERS, EXPORTS */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              
              {/* Search input */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher par nom (arabe ou latin), numéro, opérateur..."
                  className="w-full text-xs pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                  dir="auto"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Export Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => exportWhatsAppToVCF(contactsToExport, `whatsapp_contacts_${Date.now()}.vcf`)}
                  disabled={contactsToExport.length === 0}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                  title="Génère un fichier .VCF pour importer directement dans le carnet d'adresses WhatsApp du téléphone"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Exporter vCard (.vcf)</span>
                </button>

                <button
                  onClick={() => exportWhatsAppToExcel(contactsToExport, `whatsapp_tunisie_${Date.now()}.xls`)}
                  disabled={contactsToExport.length === 0}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Excel (.xls)</span>
                </button>

                <button
                  onClick={() => exportWhatsAppToCSV(contactsToExport, `whatsapp_tunisie_${Date.now()}.csv`)}
                  disabled={contactsToExport.length === 0}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  <span>CSV</span>
                </button>

                {onTransferToLeadExtractor && (
                  <button
                    onClick={() => onTransferToLeadExtractor(contactsToExport)}
                    disabled={contactsToExport.length === 0}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    title="Transfère automatiquement ces numéros vers le moteur DigiWare Lead Extractor pour enrichissement public complet"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                    <span>Enrichir Leads</span>
                  </button>
                )}

                {onTransferToSender && (
                  <button
                    onClick={() => onTransferToSender(contactsToExport)}
                    disabled={contactsToExport.length === 0}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    title="Injecter ces contacts directement dans la file d'attente du WhatsApp Business Sender pour exécution via WhatsApp Web"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>WhatsApp Business Sender</span>
                  </button>
                )}
              </div>

            </div>

            {/* Filter Pills */}
            <div className="flex items-center justify-between gap-4 pt-3 border-t border-slate-100 flex-wrap text-xs">
              
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-500 font-medium">Confiance :</span>
                {(['All', 'High', 'Medium', 'Low'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => setConfidenceFilter(level)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      confidenceFilter === level
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {level === 'All' ? 'Toutes' : level === 'High' ? 'Élevée' : level === 'Medium' ? 'Moyenne' : 'Faible'}
                  </button>
                ))}

                <span className="text-slate-300 mx-1">|</span>

                <span className="text-slate-500 font-medium">Script :</span>
                {(['All', 'arabic', 'latin'] as const).map(script => (
                  <button
                    key={script}
                    onClick={() => setScriptFilter(script)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      scriptFilter === script
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {script === 'All' ? 'Tous' : script === 'arabic' ? 'Arabe (عربي)' : 'Latin'}
                  </button>
                ))}
              </div>

              {/* Selection Summary */}
              <div className="flex items-center gap-2">
                {selectedContactIds.size > 0 ? (
                  <div className="flex items-center gap-2 bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-md border border-emerald-200">
                    <span className="font-bold">{selectedContactIds.size} sélectionné(s)</span>
                    <button 
                      onClick={clearSelection}
                      className="text-emerald-700 hover:underline text-[11px]"
                    >
                      Désélectionner
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={selectAllFiltered}
                    className="text-xs text-slate-600 hover:text-slate-900 font-medium"
                  >
                    Tout sélectionner ({filteredContacts.length})
                  </button>
                )}
              </div>

            </div>

          </div>

          {/* RESULTS TABLE */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="p-3 w-10 text-center">
                      <button 
                        onClick={toggleSelectCurrentPage}
                        className="text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
                      >
                        {isCurrentPageFullySelected ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="p-3">Nom de la personne</th>
                    <th className="p-3">Numéro de téléphone tunisien</th>
                    <th className="p-3">Opérateur</th>
                    <th className="p-3 text-center">Confiance</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedContacts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        Aucun contact WhatsApp ne correspond aux critères de recherche.
                      </td>
                    </tr>
                  ) : (
                    paginatedContacts.map((contact) => {
                      const isSelected = selectedContactIds.has(contact.id);
                      const isExpanded = expandedContactId === contact.id;
                      const isEditing = editingContactId === contact.id;

                      return (
                        <React.Fragment key={contact.id}>
                          <tr className={`hover:bg-slate-50/80 transition-all ${isSelected ? 'bg-emerald-50/30' : ''}`}>
                            
                            {/* Checkbox */}
                            <td className="p-3 text-center">
                              <button 
                                onClick={() => toggleSelectContact(contact.id)}
                                className="text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                            </td>

                            {/* Name */}
                            <td className="p-3">
                              {isEditing ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    className="text-xs px-2 py-1 border border-emerald-500 rounded bg-white"
                                    autoFocus
                                    dir="auto"
                                  />
                                  <button 
                                    onClick={() => saveEditing(contact.id)}
                                    className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => setEditingContactId(null)}
                                    className="p-1 text-slate-400 hover:text-slate-600"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span 
                                    className={`font-semibold text-slate-900 ${
                                      contact.name === 'Inconnu' ? 'text-slate-400 italic' : ''
                                    }`}
                                    dir="auto"
                                  >
                                    {contact.name}
                                  </span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium border ${
                                    contact.scriptType === 'arabic' 
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                      : contact.scriptType === 'latin' 
                                        ? 'bg-sky-50 text-sky-700 border-sky-200' 
                                        : 'bg-slate-50 text-slate-600 border-slate-200'
                                  }`}>
                                    {contact.scriptType === 'arabic' ? 'Arabe' : contact.scriptType === 'latin' ? 'Latin' : 'Mixte'}
                                  </span>
                                  {contact.isEdited && (
                                    <span className="text-[9px] text-amber-600 font-medium">Modifié</span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Phone Numbers */}
                            <td className="p-3">
                              <div className="space-y-0.5 font-mono">
                                <span className="font-bold text-slate-900 text-xs block">
                                  {contact.formattedNational}
                                </span>
                                <span className="text-[10px] text-slate-400 block">
                                  {contact.formattedInternational}
                                </span>
                              </div>
                            </td>

                            {/* Operator */}
                            <td className="p-3">
                              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
                                contact.operator === 'Ooredoo' 
                                  ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                  : contact.operator === 'Orange' 
                                    ? 'bg-orange-50 text-orange-700 border-orange-200' 
                                    : contact.operator === 'Tunisie Telecom' 
                                      ? 'bg-sky-50 text-sky-700 border-sky-200' 
                                      : contact.operator === 'Lycamobile' 
                                        ? 'bg-purple-50 text-purple-700 border-purple-200' 
                                        : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}>
                                {contact.operator}
                              </span>
                            </td>

                            {/* Confidence */}
                            <td className="p-3 text-center">
                              <div className="inline-flex flex-col items-center">
                                <span className={`text-xs font-bold ${
                                  contact.confidenceLevel === 'High' 
                                    ? 'text-emerald-700' 
                                    : contact.confidenceLevel === 'Medium' 
                                      ? 'text-amber-700' 
                                      : 'text-rose-700'
                                }`}>
                                  {contact.confidenceScore}%
                                </span>
                                <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                                  <div 
                                    className={`h-full rounded-full ${
                                      contact.confidenceLevel === 'High' 
                                        ? 'bg-emerald-500' 
                                        : contact.confidenceLevel === 'Medium' 
                                          ? 'bg-amber-500' 
                                          : 'bg-rose-500'
                                    }`}
                                    style={{ width: `${contact.confidenceScore}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* Actions */}
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                
                                {/* Direct WhatsApp Chat Link */}
                                <a
                                  href={contact.waLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-all flex items-center gap-1 text-[11px] font-semibold"
                                  title="Ouvrir dans WhatsApp Web / App"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">WhatsApp</span>
                                </a>

                                {/* Inspect Context */}
                                <button
                                  onClick={() => setExpandedContactId(isExpanded ? null : contact.id)}
                                  className={`p-1.5 rounded-lg transition-all ${
                                    isExpanded ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                                  }`}
                                  title="Voir le contexte d'origine"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                {/* Edit Name */}
                                <button
                                  onClick={() => startEditing(contact)}
                                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all"
                                  title="Modifier le nom"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>

                                {/* Delete */}
                                <button
                                  onClick={() => deleteContact(contact.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                  title="Supprimer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>

                              </div>
                            </td>

                          </tr>

                          {/* Context Expansion Row */}
                          {isExpanded && (
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <td colSpan={6} className="p-4">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                                    <span>Extrait depuis : <strong className="text-slate-700">{contact.sourceFile}</strong></span>
                                    <span>Lien direct : <a href={contact.waLink} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:underline">{contact.waLink}</a></span>
                                  </div>
                                  <div className="bg-white p-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed">
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

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Affichage de {startIndex + 1} à {endIndex} sur {totalItems} numéros
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Précédent
                  </button>
                  <span className="px-3 font-semibold text-slate-800">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-2.5 py-1 border border-slate-200 rounded bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: METHODOLOGY & RULES */}
      {/* ========================================================================= */}
      {activeTab === 'architecture' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-2xs space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-600" />
              Moteur Logique & Règles Métier du WhatsApp Extractor
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Architecture parallèle et philosophie de fonctionnement dédiée aux données tunisiennes
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-600 leading-relaxed">
            
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">1</span>
                Plan National de Numérotation Tunisien
              </h4>
              <p>
                Le moteur valide les numéros à 8 chiffres selon les attributions officielles des opérateurs en Tunisie :
              </p>
              <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                <li><strong className="text-rose-700">Ooredoo (2x) :</strong> 20 à 29 xx xx xx</li>
                <li><strong className="text-orange-700">Orange (5x) :</strong> 50 à 58 xx xx xx</li>
                <li><strong className="text-sky-700">Tunisie Telecom (9x) :</strong> 90 à 99 xx xx xx</li>
                <li><strong className="text-purple-700">Lycamobile (4x) :</strong> 40 à 48 xx xx xx</li>
                <li><strong className="text-slate-700">Lignes Fixes (7x / 3x) :</strong> Fixe régional & VoIP</li>
              </ul>
              <p className="text-[11px] text-slate-500">
                Toutes les formes (<code className="text-slate-800 font-semibold">+216 22 123 456</code>, <code className="text-slate-800 font-semibold">00216</code>, <code className="text-slate-800 font-semibold">22 123 456</code>, <code className="text-slate-800 font-semibold">22123456</code>) sont normalisées de façon déterministe.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">2</span>
                Traitement Bilingue Arabe & Latin Natif
              </h4>
              <p>
                Les noms de personnes sont reconnus de manière équitable qu'ils soient rédigés en alphabet arabe ou latin :
              </p>
              <div className="space-y-1.5 text-[11px] bg-white p-3 rounded-lg border border-slate-200">
                <div className="flex justify-between">
                  <span dir="rtl" className="font-bold text-slate-900">عمر → 22123456</span>
                  <span className="text-slate-500">Omar → 22123456</span>
                </div>
                <div className="flex justify-between">
                  <span dir="rtl" className="font-bold text-slate-900">محمد بن علي → 50456789</span>
                  <span className="text-slate-500">Mohamed Ali → 50456789</span>
                </div>
                <div className="flex justify-between">
                  <span dir="rtl" className="font-bold text-slate-900">أحمد → 98765432</span>
                  <span className="text-slate-500">Ahmed → 98765432</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Les particules arabes (<span dir="rtl" className="font-semibold text-slate-800">بن، ابن، بو، ولد، عبد</span>) sont préservées tandis que les étiquettes de bruit (<span dir="rtl" className="font-semibold text-slate-800">للبيع، هاتف، واتساب، دينار</span>) sont éliminées.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">3</span>
                Filtrage Anti-Faux Positifs
              </h4>
              <p>
                Le moteur élimine systématiquement les séquences numériques non téléphoniques :
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li><strong>Dates & Heures :</strong> 12/03/2026, 2026-03-12, 14:32:10</li>
                <li><strong>Années isolées :</strong> 2024, 2025, 2026</li>
                <li><strong>Prix & Monnaies :</strong> 150 DT, 2500 TND, 50 millimes, 20 دينار</li>
                <li><strong>Numéros de CIN :</strong> Détection et élimination des numéros de carte d'identité</li>
                <li><strong>Codes postaux :</strong> 1000, 1002, 2080, 4000, 3000 (4 chiffres)</li>
              </ul>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">4</span>
                Exportation & Intégration Directe WhatsApp
              </h4>
              <p>
                Pour chaque numéro validé, l'application génère :
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li><strong>Lien Click-to-Chat :</strong> <code className="text-emerald-700">https://wa.me/216...</code> pour ouvrir directement la discussion.</li>
                <li><strong>Export vCard (.vcf) :</strong> Télécharge un fichier de contacts standard pour synchroniser d'un clic tous les contacts dans le téléphone.</li>
                <li><strong>Export Tableurs :</strong> Formats CSV UTF-8 (avec BOM pour les accents et l'arabe) et Excel .xls stylisé.</li>
              </ul>
            </div>

          </div>
        </div>
      )}

      {/* MEMORY MANAGER MODAL */}
      <WhatsAppMemoryManager
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

    </div>
  );
};
