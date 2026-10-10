/**
 * ContactListUploader - Interface d'Upload & Ingestion en Boucle de Contacts
 * Supporte Excel (.xlsx, .xls), CSV, VCF, TXT, Copier-Coller direct, avec détection automatique de colonnes et normalisation WhatsApp.
 */
import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Users,
  Phone,
  ArrowRight,
  Search,
  Download,
  RefreshCw,
  Sparkles,
  Check,
  X,
  Layers,
  Eye,
  HelpCircle,
  Building,
  MapPin,
  ClipboardPaste,
  Send
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { CreateJobInput } from '../../types/sender';

export interface ParsedContact {
  id: string;
  phone: string;
  originalPhone: string;
  name: string;
  company?: string;
  city?: string;
  isValid: boolean;
  isDuplicate?: boolean;
  raw?: Record<string, any>;
}

interface ContactListUploaderProps {
  lang: 'fr' | 'en';
  campaignId: string;
  messageTemplate: string;
  onInjectContacts: (jobs: CreateJobInput[]) => Promise<void>;
  onCancel?: () => void;
}

export const ContactListUploader: React.FC<ContactListUploaderProps> = ({
  lang,
  campaignId,
  messageTemplate,
  onInjectContacts,
  onCancel
}) => {
  const [activeInputMode, setActiveInputMode] = useState<'FILE' | 'PASTE'>('FILE');
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [rawPasteText, setRawPasteText] = useState('');
  
  // Parsed contacts list
  const [contacts, setContacts] = useState<ParsedContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewContact, setPreviewContact] = useState<ParsedContact | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const t = {
    fr: {
      title: 'Import & Upload de la Liste des Contacts',
      subtitle: 'Chargez vos fichiers Excel, CSV ou listes brutes pour alimenter le pupitre d’envoi en boucle.',
      tabFile: 'Fichier Excel / CSV / TXT',
      tabPaste: 'Copier-Coller Direct',
      dragDropTitle: 'Glissez-déposez votre fichier de contacts ici',
      dragDropDesc: 'Formats acceptés : Excel (.xlsx, .xls), CSV (.csv), Carnet vCard (.vcf) ou Texte (.txt)',
      browseFile: 'Parcourir un fichier...',
      downloadSampleCsv: 'Télécharger un modèle CSV exemple',
      pasteLabel: 'Collez votre liste de numéros ou lignes texte :',
      pastePlaceholder: 'Exemple :\n+216 98 123 456, Maître Dupont, Avocat, Tunis\n216 20 456 789; Dr Ben Salem; Cabinet Médical; Sfax\n55 678 901, Société Tech, Informatique, Sousse',
      parsePasteBtn: 'Analyser et Extraire les Contacts',
      statsTotal: 'Contacts Détectés',
      statsValid: 'Numéros Valides',
      statsDuplicates: 'Doublons Écartés',
      statsInvalid: 'Invalides',
      searchPlaceholder: 'Filtrer les contacts analysés (nom, numéro, ville)...',
      deduplicateLabel: 'Déduplication automatique (ignorer les doublons de numéros)',
      thSelect: 'Sélection',
      thPhone: 'Numéro WhatsApp',
      thName: 'Nom du Contact',
      thCompany: 'Entreprise / Société',
      thCity: 'Ville / Localité',
      thStatus: 'Statut',
      previewBtn: 'Aperçu Message Spintax',
      modalPreviewTitle: 'Aperçu du Message Personnalisé',
      injectBtn: 'Mettre à jour & Injecter dans la File d’Envoi',
      processing: 'Injection en cours...',
      noContactsYet: 'Aucun contact importé. Uploadez un fichier ou collez une liste ci-dessus.',
      validBadge: 'Valide',
      invalidBadge: 'Invalide',
      selectAll: 'Tout sélectionner',
      deselectAll: 'Tout désélectionner'
    },
    en: {
      title: 'Import & Upload Contact List',
      subtitle: 'Upload Excel, CSV, or raw text lists to feed the automated broadcast sending desk.',
      tabFile: 'Excel / CSV / TXT File',
      tabPaste: 'Direct Copy-Paste',
      dragDropTitle: 'Drag and drop your contact file here',
      dragDropDesc: 'Supported formats: Excel (.xlsx, .xls), CSV (.csv), vCard (.vcf), or Text (.txt)',
      browseFile: 'Browse files...',
      downloadSampleCsv: 'Download Sample CSV Template',
      pasteLabel: 'Paste your raw list of phone numbers and names:',
      pastePlaceholder: 'Example:\n+216 98 123 456, Master Dupont, Lawyer, Tunis\n216 20 456 789; Dr Ben Salem; Clinic; Sfax\n55 678 901, Tech Ltd, IT, Sousse',
      parsePasteBtn: 'Parse & Extract Contacts',
      statsTotal: 'Total Detected',
      statsValid: 'Valid Numbers',
      statsDuplicates: 'Duplicates Filtered',
      statsInvalid: 'Invalid',
      searchPlaceholder: 'Filter parsed contacts (name, number, city)...',
      deduplicateLabel: 'Automatic deduplication (skip duplicate numbers)',
      thSelect: 'Select',
      thPhone: 'WhatsApp Number',
      thName: 'Contact Name',
      thCompany: 'Company / Org',
      thCity: 'City / Location',
      thStatus: 'Status',
      previewBtn: 'Preview Spintax Message',
      modalPreviewTitle: 'Personalized Message Preview',
      injectBtn: 'Update & Inject into Send Queue',
      processing: 'Injecting...',
      noContactsYet: 'No contacts imported yet. Upload a file or paste a list above.',
      validBadge: 'Valid',
      invalidBadge: 'Invalid',
      selectAll: 'Select all',
      deselectAll: 'Deselect all'
    }
  }[lang];

  // ---------------------------------------------------------------------------
  // Phone Normalizer for WhatsApp (Tunisia +216 & International)
  // ---------------------------------------------------------------------------
  const normalizePhoneNumber = (raw: string): { normalized: string; isValid: boolean } => {
    if (!raw) return { normalized: '', isValid: false };
    
    // Clean spaces, dots, dashes, parentheses
    let cleaned = raw.replace(/[^\d+]/g, '');

    // If starts with 00, replace with +
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.slice(2);
    }

    // Handle Tunisian formats (Tunisian local 8 digits starting with 2, 4, 5, 7, 9)
    if (/^[24579]\d{7}$/.test(cleaned)) {
      return { normalized: `216${cleaned}`, isValid: true };
    }

    // If 216 followed by 8 digits
    if (/^216[24579]\d{7}$/.test(cleaned)) {
      return { normalized: cleaned, isValid: true };
    }

    // If +216 followed by 8 digits
    if (/^\+216[24579]\d{7}$/.test(cleaned)) {
      return { normalized: cleaned.slice(1), isValid: true };
    }

    // International numbers with +
    if (cleaned.startsWith('+') && cleaned.length >= 8 && cleaned.length <= 16) {
      return { normalized: cleaned.slice(1), isValid: true };
    }

    // Numeric international without + (e.g. 33612345678, 14155552671)
    if (cleaned.length >= 9 && cleaned.length <= 15) {
      return { normalized: cleaned, isValid: true };
    }

    return { normalized: cleaned, isValid: false };
  };

  // ---------------------------------------------------------------------------
  // File Parsing (Excel, CSV, TXT, VCF)
  // ---------------------------------------------------------------------------
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processUploadedFile(e.target.files[0]);
    }
  };

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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const processUploadedFile = async (file: File) => {
    setFileName(file.name);
    setFileSize(file.size);

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      parseArrayRows(rows);
    } else {
      // Text, CSV, VCF
      const text = await file.text();
      if (ext === 'csv' || text.includes(',') || text.includes(';') || text.includes('\t')) {
        parseDelimitedText(text);
      } else if (ext === 'vcf') {
        parseVcfText(text);
      } else {
        parseLineByLineText(text);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Generic Parser Helpers
  // ---------------------------------------------------------------------------
  const parseArrayRows = (rows: any[][]) => {
    if (!rows || rows.length === 0) return;

    // Detect header row if string based
    let phoneColIdx = -1;
    let nameColIdx = -1;
    let companyColIdx = -1;
    let cityColIdx = -1;

    const firstRow = rows[0] || [];
    firstRow.forEach((cell: any, idx: number) => {
      const col = String(cell || '').toLowerCase().trim();
      if (col.includes('tel') || col.includes('phone') || col.includes('mobile') || col.includes('num') || col.includes('whatsapp')) {
        phoneColIdx = idx;
      } else if (col.includes('nom') || col.includes('name') || col.includes('contact') || col.includes('client') || col.includes('prospect')) {
        nameColIdx = idx;
      } else if (col.includes('societe') || col.includes('entreprise') || col.includes('company') || col.includes('cabinet') || col.includes('org')) {
        companyColIdx = idx;
      } else if (col.includes('ville') || col.includes('city') || col.includes('gov') || col.includes('adresse')) {
        cityColIdx = idx;
      }
    });

    const parsed: ParsedContact[] = [];
    const seenPhones = new Set<string>();

    const startRow = (phoneColIdx !== -1 || nameColIdx !== -1) ? 1 : 0;

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      let phoneRaw = '';
      let nameRaw = '';
      let compRaw = '';
      let cityRaw = '';

      if (phoneColIdx !== -1 && row[phoneColIdx] !== undefined) {
        phoneRaw = String(row[phoneColIdx] || '');
      } else {
        // Fallback: look for cell matching phone number
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').trim();
          if (/^(\+?216)?\s*[24579]\d{7}$/.test(val.replace(/[^\d+]/g, '')) || /^\+?\d{8,15}$/.test(val.replace(/[^\d+]/g, ''))) {
            phoneRaw = val;
            break;
          }
        }
      }

      if (nameColIdx !== -1 && row[nameColIdx] !== undefined) {
        nameRaw = String(row[nameColIdx] || '').trim();
      }
      if (companyColIdx !== -1 && row[companyColIdx] !== undefined) {
        compRaw = String(row[companyColIdx] || '').trim();
      }
      if (cityColIdx !== -1 && row[cityColIdx] !== undefined) {
        cityRaw = String(row[cityColIdx] || '').trim();
      }

      if (!phoneRaw) continue;

      const { normalized, isValid } = normalizePhoneNumber(phoneRaw);
      const isDuplicate = seenPhones.has(normalized);
      if (isValid) seenPhones.add(normalized);

      parsed.push({
        id: `C-ROW-${r + 1}`,
        phone: normalized,
        originalPhone: phoneRaw,
        name: nameRaw || 'Monsieur/Madame',
        company: compRaw,
        city: cityRaw,
        isValid,
        isDuplicate
      });
    }

    setContacts(parsed);
    setSelectedIds(new Set(parsed.filter(c => c.isValid && (!removeDuplicates || !c.isDuplicate)).map(c => c.id)));
  };

  const parseDelimitedText = (text: string) => {
    // Detect delimiter: comma, semicolon, tab
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return;

    const first = lines[0];
    let delimiter = ',';
    if (first.includes(';')) delimiter = ';';
    else if (first.includes('\t')) delimiter = '\t';

    const rows = lines.map(line => line.split(delimiter).map(cell => cell.replace(/^["']|["']$/g, '').trim()));
    parseArrayRows(rows);
  };

  const parseLineByLineText = (text: string) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const parsed: ParsedContact[] = [];
    const seen = new Set<string>();

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // Match phone in line
      const phoneMatch = trimmed.match(/(\+?216)?\s*[24579]\d{7}/) || trimmed.match(/\+?\d{8,15}/);
      if (phoneMatch) {
        const phoneRaw = phoneMatch[0];
        const { normalized, isValid } = normalizePhoneNumber(phoneRaw);
        const isDuplicate = seen.has(normalized);
        if (isValid) seen.add(normalized);

        // Name might be the rest of line
        let nameCandidate = trimmed.replace(phoneRaw, '').replace(/[-–—,:;()]/g, ' ').trim();
        nameCandidate = nameCandidate.replace(/\s+/g, ' ');

        parsed.push({
          id: `C-LINE-${idx + 1}`,
          phone: normalized,
          originalPhone: phoneRaw,
          name: nameCandidate || 'Monsieur/Madame',
          isValid,
          isDuplicate
        });
      }
    });

    setContacts(parsed);
    setSelectedIds(new Set(parsed.filter(c => c.isValid && (!removeDuplicates || !c.isDuplicate)).map(c => c.id)));
  };

  const parseVcfText = (vcf: string) => {
    const cards = vcf.split(/BEGIN:VCARD/i).filter(c => c.trim().length > 0);
    const parsed: ParsedContact[] = [];
    const seen = new Set<string>();

    cards.forEach((card, idx) => {
      const fnMatch = card.match(/FN:(.+)/i);
      const telMatch = card.match(/TEL.*:(.+)/i);
      const orgMatch = card.match(/ORG:(.+)/i);

      if (telMatch && telMatch[1]) {
        const phoneRaw = telMatch[1].trim();
        const { normalized, isValid } = normalizePhoneNumber(phoneRaw);
        const isDuplicate = seen.has(normalized);
        if (isValid) seen.add(normalized);

        parsed.push({
          id: `C-VCF-${idx + 1}`,
          phone: normalized,
          originalPhone: phoneRaw,
          name: fnMatch ? fnMatch[1].trim() : 'Monsieur/Madame',
          company: orgMatch ? orgMatch[1].trim() : '',
          isValid,
          isDuplicate
        });
      }
    });

    setContacts(parsed);
    setSelectedIds(new Set(parsed.filter(c => c.isValid && (!removeDuplicates || !c.isDuplicate)).map(c => c.id)));
  };

  const handleParsePaste = () => {
    if (!rawPasteText.trim()) return;
    parseDelimitedText(rawPasteText);
  };

  // ---------------------------------------------------------------------------
  // Selection & Actions
  // ---------------------------------------------------------------------------
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const validFiltered = contacts.filter(c => c.isValid && (!removeDuplicates || !c.isDuplicate));
    setSelectedIds(new Set(validFiltered.map(c => c.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // Download Sample CSV
  const handleDownloadSampleCsv = () => {
    const sample = `Nom,Telephone,Entreprise,Ville\n"Maître Mohamed Ben Salem","+216 98 111 222","Cabinet d'Avocats Ben Salem","Tunis"\n"Dr. Sophie Martin","+216 20 333 444","Clinique Les Berges","Ariana"\n"Directeur Commercial","+216 55 555 666","DigiWare Partner","Sousse"\n"Atelier Maintenance IT","+216 22 777 888","Tech Solutions Sfax","Sfax"`;
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'modele_contacts_whatsapp_sender.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ---------------------------------------------------------------------------
  // Submit & Inject Bulk into Sending Desk
  // ---------------------------------------------------------------------------
  const handleInject = async () => {
    const selectedContacts = contacts.filter(c => selectedIds.has(c.id));
    if (selectedContacts.length === 0) return;

    try {
      setIsSubmitting(true);
      const jobs: CreateJobInput[] = selectedContacts.map((c, i) => {
        return {
          contact_id: c.id,
          phone: c.phone.startsWith('+') ? c.phone : `+${c.phone}`,
          message: messageTemplate,
          campaign_id: campaignId || 'CAMP_BULK_UPLOAD',
          metadata: {
            nom: c.name || 'Monsieur/Madame',
            name: c.name || 'Monsieur/Madame',
            entreprise: c.company || '',
            ville: c.city || '',
            originalPhone: c.originalPhone,
            source: fileName ? `Upload: ${fileName}` : 'Upload: Copier-Coller Direct',
            imported_at: new Date().toISOString()
          }
        };
      });

      await onInjectContacts(jobs);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered contacts for table
  const filteredContacts = contacts.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.phone.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.company && c.company.toLowerCase().includes(q)) ||
      (c.city && c.city.toLowerCase().includes(q))
    );
  });

  const validCount = contacts.filter(c => c.isValid).length;
  const duplicateCount = contacts.filter(c => c.isDuplicate).length;
  const invalidCount = contacts.filter(c => !c.isValid).length;
  const selectedCount = selectedIds.size;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-6">
      
      {/* Header & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>{t.title}</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold">
                Pupitre d'Envoi
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {t.subtitle}
            </p>
          </div>
        </div>

        {/* Action Sample CSV Download */}
        <button
          onClick={handleDownloadSampleCsv}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-all cursor-pointer self-start md:self-auto"
        >
          <Download className="w-3.5 h-3.5 text-blue-400" />
          <span>{t.downloadSampleCsv}</span>
        </button>
      </div>

      {/* Tabs: File Upload vs Copy-Paste */}
      <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs max-w-md">
        <button
          onClick={() => setActiveInputMode('FILE')}
          className={`flex-1 py-2 font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
            activeInputMode === 'FILE' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>{t.tabFile}</span>
        </button>
        <button
          onClick={() => setActiveInputMode('PASTE')}
          className={`flex-1 py-2 font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
            activeInputMode === 'PASTE' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          <ClipboardPaste className="w-4 h-4" />
          <span>{t.tabPaste}</span>
        </button>
      </div>

      {/* Mode A: File Upload */}
      {activeInputMode === 'FILE' && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all bg-slate-950/60 ${
            isDragging ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".xlsx,.xls,.csv,.txt,.vcf"
            className="hidden"
          />
          <div className="flex flex-col items-center max-w-md mx-auto space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t.dragDropTitle}</h3>
              <p className="text-xs text-slate-400 mt-1">{t.dragDropDesc}</p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-emerald-950/60"
            >
              {t.browseFile}
            </button>
          </div>
        </div>
      )}

      {/* Mode B: Direct Paste */}
      {activeInputMode === 'PASTE' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center text-xs">
            <label className="text-slate-300 font-semibold">{t.pasteLabel}</label>
            <span className="text-[11px] text-slate-500">Séparateurs acceptés : virgule, point-virgule ou tabulation</span>
          </div>
          <textarea
            rows={5}
            value={rawPasteText}
            onChange={(e) => setRawPasteText(e.target.value)}
            placeholder={t.pastePlaceholder}
            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-xs font-mono text-slate-200 focus:ring-1 focus:ring-emerald-500 transition-all"
          />
          <div className="flex justify-end">
            <button
              onClick={handleParsePaste}
              disabled={!rawPasteText.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-2 shadow-md"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t.parsePasteBtn}</span>
            </button>
          </div>
        </div>
      )}

      {/* File Loaded Pill */}
      {fileName && (
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">{fileName}</span>
            {fileSize && (
              <span className="text-slate-500 font-mono">({Math.round(fileSize / 1024)} Ko)</span>
            )}
          </div>
          <button
            onClick={() => {
              setFileName(null);
              setFileSize(null);
              setContacts([]);
              setSelectedIds(new Set());
            }}
            className="p-1 text-slate-400 hover:text-red-400 transition-colors"
            title="Effacer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Stats Strip */}
      {contacts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 block">{t.statsTotal}</span>
            <span className="text-xl font-bold text-white font-mono mt-0.5 block">{contacts.length}</span>
          </div>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] text-emerald-400 block">{t.statsValid}</span>
            <span className="text-xl font-bold text-emerald-400 font-mono mt-0.5 block">{validCount}</span>
          </div>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] text-amber-400 block">{t.statsDuplicates}</span>
            <span className="text-xl font-bold text-amber-400 font-mono mt-0.5 block">{duplicateCount}</span>
          </div>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
            <span className="text-[11px] text-red-400 block">{t.statsInvalid}</span>
            <span className="text-xl font-bold text-red-400 font-mono mt-0.5 block">{invalidCount}</span>
          </div>
        </div>
      )}

      {/* Deduplication & Controls Toolbar */}
      {contacts.length > 0 && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs border-t border-slate-800 pt-4">
          
          {/* Deduplicate Checkbox & Select All */}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-slate-300 font-medium">
              <input
                type="checkbox"
                checked={removeDuplicates}
                onChange={(e) => {
                  setRemoveDuplicates(e.target.checked);
                  if (e.target.checked) {
                    setSelectedIds(new Set(contacts.filter(c => c.isValid && !c.isDuplicate).map(c => c.id)));
                  } else {
                    setSelectedIds(new Set(contacts.filter(c => c.isValid).map(c => c.id)));
                  }
                }}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
              <span>{t.deduplicateLabel}</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
              >
                {t.selectAll}
              </button>
              <span className="text-slate-600">•</span>
              <button
                onClick={deselectAll}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                {t.deselectAll}
              </button>
            </div>
          </div>

          {/* Quick Search inside parsed list */}
          <div className="relative w-full md:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white"
            />
          </div>

        </div>
      )}

      {/* Contacts Table */}
      {contacts.length > 0 && (
        <div className="border border-slate-800 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] font-mono sticky top-0 border-b border-slate-800">
              <tr>
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={selectedCount > 0 && selectedCount === contacts.filter(c => c.isValid).length}
                    onChange={(e) => {
                      if (e.target.checked) selectAll();
                      else deselectAll();
                    }}
                    className="accent-emerald-500 rounded cursor-pointer"
                  />
                </th>
                <th className="p-3">{t.thPhone}</th>
                <th className="p-3">{t.thName}</th>
                <th className="p-3">{t.thCompany}</th>
                <th className="p-3">{t.thCity}</th>
                <th className="p-3 text-right">{t.thStatus}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/60 font-mono">
              {filteredContacts.map(c => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <tr
                    key={c.id}
                    onClick={() => c.isValid && toggleSelect(c.id)}
                    className={`hover:bg-slate-800/50 transition-colors cursor-pointer ${
                      !c.isValid ? 'opacity-40 bg-red-950/10' : isSelected ? 'bg-emerald-950/20' : ''
                    }`}
                  >
                    <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        disabled={!c.isValid}
                        checked={isSelected}
                        onChange={() => toggleSelect(c.id)}
                        className="accent-emerald-500 rounded cursor-pointer"
                      />
                    </td>
                    <td className="p-3 font-bold text-white">
                      +{c.phone}
                    </td>
                    <td className="p-3 font-sans text-slate-200">
                      {c.name}
                    </td>
                    <td className="p-3 font-sans text-slate-400">
                      {c.company || '—'}
                    </td>
                    <td className="p-3 font-sans text-slate-400">
                      {c.city || '—'}
                    </td>
                    <td className="p-3 text-right">
                      {c.isValid ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                          <Check className="w-2.5 h-2.5" />
                          <span>{t.validBadge}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-red-950 text-red-300 border border-red-500/30">
                          <X className="w-2.5 h-2.5" />
                          <span>{t.invalidBadge}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Radical Big Submit Button */}
      {contacts.length > 0 && (
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-400">
            <strong className="text-white font-mono">{selectedCount}</strong> {lang === 'fr' ? 'contacts prêts à être injectés dans la file d’attente' : 'contacts ready to be injected into queue'}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
            )}

            <button
              onClick={handleInject}
              disabled={isSubmitting || selectedCount === 0}
              className="flex-1 sm:flex-initial px-6 py-3 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xl shadow-emerald-950/70 transition-all cursor-pointer flex items-center justify-center gap-2 ring-2 ring-emerald-400/30 active:scale-98"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{t.processing}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>{t.injectBtn} ({selectedCount})</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
