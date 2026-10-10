import React, { useState, useEffect } from 'react';
import { 
  X, Download, FileSpreadsheet, Phone, 
  Layers, CheckCircle2, UserCheck
} from 'lucide-react';
import { LeadExportOptions, SegmentDefinition, LeadFilterOptions } from '../../types/lead';
import { leadApi } from '../../services/leadApi';

interface ExportModalProps {
  isOpen?: boolean;
  segments: SegmentDefinition[];
  filterOptions?: LeadFilterOptions;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ 
  isOpen = true, 
  segments, 
  filterOptions,
  onClose 
}) => {
  const [scope, setScope] = useState<'all' | 'by_segment'>('all');
  const [selectedSegment, setSelectedSegment] = useState<string>(segments[0]?.code || 'AVOCAT');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExporting, onClose]);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await leadApi.exportCSV({
        type: scope === 'by_segment' ? 'by_segment' : 'phone_only',
        segmentCode: scope === 'by_segment' ? selectedSegment : undefined,
        filterOptions
      });
      setIsExporting(false);
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      setIsExporting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isExporting) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Exporter les Contacts en CSV</h2>
              <p className="text-xs text-slate-300">Format épuré : Noms et Numéros de téléphone uniquement</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            disabled={isExporting}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Format Preview Box */}
          <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Colonnes exportées dans le CSV :
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-emerald-100 font-semibold text-slate-800">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                1. Nom de la personne
              </div>
              <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-emerald-100 font-semibold text-slate-800">
                <Phone className="w-4 h-4 text-emerald-600" />
                2. Numéro de téléphone
              </div>
            </div>
            <p className="text-[11px] text-emerald-700 mt-1">
              Fichier CSV propre sans données superflues, directement importable dans vos campagnes WhatsApp ou SMS.
            </p>
          </div>

          <label className="text-xs font-bold text-slate-700 block">Périmètre de l'export :</label>

          <div className="grid grid-cols-1 gap-2.5">
            {/* Choice 1: All contacts */}
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                scope === 'all'
                  ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-600/20'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg mt-0.5">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold text-slate-900">Tous les contacts extraits</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Exporte l'ensemble des numéros et noms détectés dans la base.
                </div>
              </div>
            </button>

            {/* Choice 2: By Sector / Segment */}
            <button
              type="button"
              onClick={() => setScope('by_segment')}
              className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                scope === 'by_segment'
                  ? 'border-purple-600 bg-purple-50/50 ring-2 ring-purple-600/20'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="p-2 bg-purple-100 text-purple-700 rounded-lg mt-0.5">
                <Layers className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold text-slate-900">Filtrer par secteur d'activité</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Exporte uniquement les noms et numéros d'un secteur précis.
                </div>
              </div>
            </button>
          </div>

          {/* Segment Selector if by_segment is chosen */}
          {scope === 'by_segment' && (
            <div className="pt-2">
              <label className="text-xs font-bold text-slate-700 block mb-1">Choisir le secteur :</label>
              <select
                value={selectedSegment}
                onChange={(e) => setSelectedSegment(e.target.value)}
                className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
              >
                {segments.map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.label} ({s.code})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? 'Génération du CSV...' : 'Télécharger le CSV (Nom & Téléphone)'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
