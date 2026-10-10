import React, { useState, useEffect } from 'react';
import { X, Layers, Plus, Trash2, Check, Tag, Sparkles } from 'lucide-react';
import { SegmentDefinition } from '../../types/lead';
import { leadApi } from '../../services/leadApi';

interface SegmentManagerModalProps {
  isOpen?: boolean;
  segments: SegmentDefinition[];
  onRefresh?: () => void;
  onSegmentCreated?: () => void;
  onClose: () => void;
}

export const SegmentManagerModal: React.FC<SegmentManagerModalProps> = ({
  isOpen = true,
  segments,
  onRefresh,
  onSegmentCreated,
  onClose
}) => {
  const [newCode, setNewCode] = useState<string>('');
  const [newLabel, setNewLabel] = useState<string>('');
  const [newKeywords, setNewKeywords] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const triggerRefresh = () => {
    if (onRefresh) onRefresh();
    if (onSegmentCreated) onSegmentCreated();
  };

  const handleAddSegment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newLabel.trim()) return;

    setIsSaving(true);
    const keywordsArray = newKeywords
      .split(/[,;\n]/)
      .map(k => k.trim())
      .filter(Boolean);

    const newSeg: SegmentDefinition = {
      id: `seg-${Date.now()}`,
      code: newCode.toUpperCase().replace(/\s+/g, '_').trim(),
      label: newLabel.trim(),
      keywords: keywordsArray,
      isCustom: true,
      color: 'indigo'
    };

    try {
      await leadApi.saveSegment(newSeg);
      setNewCode('');
      setNewLabel('');
      setNewKeywords('');
      setIsSaving(false);
      triggerRefresh();
    } catch (err) {
      console.error('Error adding segment:', err);
      setIsSaving(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4.5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Gestionnaire de Secteurs & Segments</h2>
              <p className="text-xs text-slate-300">Classification modifiable et extensible pour la prospection</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          
          {/* Add New Segment Form */}
          <form onSubmit={handleAddSegment} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-indigo-600" />
              <span>Ajouter un Nouveau Secteur de Prospection</span>
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">Code Unique (ex: IMMOBILIER)</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="AGENCE_IMMO"
                  className="w-full px-3 py-1.5 text-xs font-mono uppercase bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">Libellé Affiché</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Agences Immobilières"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">Mots-clés de détection (séparés par des virgules)</label>
              <input
                type="text"
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                placeholder="immobilier, agence immo, vente appartement, syndic, عقارات"
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving || !newCode.trim() || !newLabel.trim()}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Enregistrement...' : 'Enregistrer le Secteur'}</span>
              </button>
            </div>
          </form>

          {/* Existing Segments List */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Secteurs Configurés ({segments.length})
            </h3>

            <div className="space-y-2">
              {segments.map((seg) => (
                <div key={seg.id} className="p-3 bg-white border border-slate-200 rounded-xl flex items-start justify-between shadow-2xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{seg.label}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded font-semibold">
                        {seg.code}
                      </span>
                      {seg.isCustom && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 bg-indigo-50 text-indigo-600 rounded">
                          Personnalisé
                        </span>
                      )}
                    </div>
                    {seg.keywords && seg.keywords.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-1.5">
                        {seg.keywords.slice(0, 6).map((kw, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-50 text-slate-500 border border-slate-200/60 rounded">
                            {kw}
                          </span>
                        ))}
                        {seg.keywords.length > 6 && (
                          <span className="text-[10px] text-slate-400">+{seg.keywords.length - 6}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            Fermer
          </button>
        </div>

      </div>
    </div>
  );
};
