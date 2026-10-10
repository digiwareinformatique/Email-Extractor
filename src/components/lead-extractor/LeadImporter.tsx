import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, FileText, Check, AlertCircle, ArrowRight, 
  Sparkles, RefreshCw, X, CheckCircle2, Phone 
} from 'lucide-react';
import { leadApi } from '../../services/leadApi';

interface LeadImporterProps {
  isOpen?: boolean;
  onImportComplete?: () => void;
  onImportSuccess?: () => void;
  onClose: () => void;
}

export const LeadImporter: React.FC<LeadImporterProps> = ({ 
  isOpen = true, 
  onImportComplete, 
  onImportSuccess, 
  onClose 
}) => {
  const [pasteText, setPasteText] = useState<string>('');
  const [sourceName, setSourceName] = useState<string>('Import Manuel CSV/TXT');
  const [targetMetier, setTargetMetier] = useState<string>('AVOCAT');
  const [autoStart, setAutoStart] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [resultSummary, setResultSummary] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isProcessing, onClose]);

  if (!isOpen) return null;

  const sampleNumbers = `21656047243, أمل خالدي, Tunis
71240375, Cabinet Conseil Tunis
22123456, Société Informatique
98456789, Dr Ben Salem
50123456, École Privée Elite
29876543, Bureau d'études Ingénierie`;

  const handleFileUpload = (file: File) => {
    setSourceName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        setPasteText(content);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const triggerSuccess = () => {
    if (onImportComplete) onImportComplete();
    if (onImportSuccess) onImportSuccess();
  };

  const handleSubmit = async () => {
    if (!pasteText.trim()) {
      setErrorMessage('Veuillez coller ou importer une liste de numéros.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const res = await leadApi.importLeads(pasteText, sourceName, autoStart, targetMetier);
      setResultSummary(res);
      setIsProcessing(false);
      triggerSuccess();
    } catch (err: any) {
      setErrorMessage(err.message || "Erreur lors de l'import");
      setIsProcessing(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Importer des Numéros & Leads</h2>
              <p className="text-xs text-slate-300">Format Tunisien (+216, 8 chiffres, CSV, TXT ou texte brut)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {resultSummary ? (
            <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-emerald-950">Importation Terminée avec Succès !</h3>
              <div className="grid grid-cols-3 gap-2 text-xs max-w-md mx-auto">
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
                  <div className="text-emerald-700 font-bold text-base font-mono">{resultSummary.importedCount}</div>
                  <div className="text-slate-500 text-[11px]">Nouveaux Leads</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
                  <div className="text-amber-700 font-bold text-base font-mono">{resultSummary.duplicateCount}</div>
                  <div className="text-slate-500 text-[11px]">Doublons Fusionnés</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
                  <div className="text-slate-700 font-bold text-base font-mono">{resultSummary.invalidCount}</div>
                  <div className="text-slate-500 text-[11px]">Lignes Ignorées</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 px-5 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
              >
                Accéder aux Leads
              </button>
            </div>
          ) : (
            <>
              {/* Drag & Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-50/50 scale-[0.99]' 
                    : 'border-slate-200 hover:border-indigo-400 bg-slate-50/50'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                  accept=".csv,.txt"
                  className="hidden"
                />
                <Upload className="w-7 h-7 text-indigo-500 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">
                  Glissez-déposez votre fichier <span className="text-indigo-600 font-mono font-bold">.CSV</span> ou <span className="text-indigo-600 font-mono font-bold">.TXT</span> ici
                </p>
                <p className="text-[11px] text-slate-400 mt-1">Ou cliquez pour parcourir vos dossiers</p>
              </div>

              {/* Paste Text Area */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span>Ou Collez Directement la Liste de Numéros :</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPasteText(sampleNumbers)}
                    className="text-[11px] text-indigo-600 hover:underline font-semibold cursor-pointer"
                  >
                    Exemple de données
                  </button>
                </div>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="21622123456&#10;50 123 456, Nom Société&#10;+216 98 765 432..."
                  rows={7}
                  className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none placeholder:text-slate-400"
                />
              </div>

              {/* Source Name & Métier Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Métier / Segment Ciblé</label>
                  <select
                    value={targetMetier}
                    onChange={(e) => setTargetMetier(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium text-slate-800"
                  >
                    <option value="AVOCAT">⚖️ Avocats & Cabinets Juridiques (Maître / Barreau)</option>
                    <option value="ECOLE_PRIVEE">🎓 Écoles Privées & Établissements Scolaires</option>
                    <option value="SANTE">🩺 Médecins & Professionnels de Santé (Docteur / Clinique)</option>
                    <option value="COMPTABLE">📊 Experts-Comptables & Commissaires aux comptes</option>
                    <option value="BUREAU_ETUDE">📐 Bureaux d'Études & Architectes</option>
                    <option value="ENTREPRISE">🏢 Entreprises & Sociétés Générales</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Nom du Lot / Fichier Source</label>
                  <input
                    type="text"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="ex: Fichier_Avocats_Tunis.csv"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl flex items-center justify-between">
                <label className="flex items-center gap-2.5 text-xs text-indigo-950 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) => setAutoStart(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-indigo-300 cursor-pointer"
                  />
                  <span>Lancer automatiquement l'enquête et l'enrichissement en arrière-plan</span>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!resultSummary && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isProcessing || !pasteText.trim()}
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Traitement & Déduplication...</span>
                </>
              ) : (
                <>
                  <span>Importer les Leads</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
