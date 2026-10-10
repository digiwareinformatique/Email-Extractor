import React, { useState } from 'react';
import { Layers, Check, X, ArrowRight, CheckSquare, Square, RefreshCw } from 'lucide-react';
import { ContactRecord } from '../types';

interface PageRangeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalPages: number;
  itemsPerPage: number;
  filteredContacts: ContactRecord[];
  selectedContactIds: Set<string>;
  onSelectRange: (startPage: number, endPage: number, mode: 'add' | 'replace' | 'remove') => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
}

export const PageRangeSelectorModal: React.FC<PageRangeSelectorModalProps> = ({
  isOpen,
  onClose,
  totalPages = 1,
  itemsPerPage = 100,
  filteredContacts = [],
  selectedContactIds = new Set(),
  onSelectRange,
  onSelectAllFiltered,
  onClearSelection
}) => {
  const [startPage, setStartPage] = useState<number>(4);
  const [endPage, setEndPage] = useState<number>(7);

  if (!isOpen) return null;

  // Calculate range bounds
  const validStart = Math.max(1, Math.min(startPage, totalPages));
  const validEnd = Math.max(validStart, Math.min(endPage, totalPages));
  const pagesCount = validEnd - validStart + 1;

  // Calculate total contacts in this range
  const rangeStartIndex = (validStart - 1) * itemsPerPage;
  const rangeEndIndex = Math.min(validEnd * itemsPerPage, filteredContacts.length);
  const contactsInRange = filteredContacts.slice(rangeStartIndex, rangeEndIndex);
  const contactsCount = contactsInRange.length;

  const handleApply = (mode: 'add' | 'replace' | 'remove') => {
    onSelectRange(validStart, validEnd, mode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div 
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden my-8 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-950 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-lg text-emerald-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Sélection Multi-Pages par Plage</h2>
              <p className="text-xs text-slate-400">
                Sélectionnez plusieurs pages de 100 contacts en une seule action.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 hover:bg-slate-800 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          
          {/* Active selection summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-600 font-medium">
              Sélection actuelle : <span className="font-bold text-slate-900">{selectedContactIds.size}</span> contacts
            </span>
            {selectedContactIds.size > 0 && (
              <button 
                onClick={onClearSelection}
                className="text-rose-600 hover:text-rose-700 font-semibold cursor-pointer"
              >
                Vider la sélection
              </button>
            )}
          </div>

          {/* Range Inputs */}
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Plage de pages à sélectionner :
            </label>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Page de départ (Ex: 4)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-medium">Page</span>
                  <input 
                    type="number"
                    min={1}
                    max={totalPages}
                    value={startPage}
                    onChange={(e) => setStartPage(Number(e.target.value))}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Page de fin (Ex: 7)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-medium">Page</span>
                  <input 
                    type="number"
                    min={1}
                    max={totalPages}
                    value={endPage}
                    onChange={(e) => setEndPage(Number(e.target.value))}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950"
                  />
                </div>
              </div>
            </div>

            {/* Live calculation banner */}
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1 text-emerald-900">
              <div className="flex items-center justify-between font-bold text-xs">
                <span>Plage calculée : Pages {validStart} à {validEnd}</span>
                <span className="bg-emerald-200/60 text-emerald-950 px-2 py-0.5 rounded-md font-mono text-[11px]">
                  {pagesCount} page(s)
                </span>
              </div>
              <p className="text-xs font-semibold text-emerald-800">
                👉 Correspond à exactement <span className="font-extrabold text-slate-950 underline">{contactsCount} contacts</span> ({itemsPerPage} par page).
              </p>
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Raccourcis rapides :
            </span>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => { setStartPage(1); setEndPage(totalPages); }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-all cursor-pointer"
              >
                Toutes les pages (1 à {totalPages})
              </button>
              {totalPages >= 4 && (
                <button
                  type="button"
                  onClick={() => { setStartPage(4); setEndPage(Math.min(7, totalPages)); }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition-all cursor-pointer"
                >
                  Pages 4 à {Math.min(7, totalPages)} (Exemple 400 leads)
                </button>
              )}
            </div>
          </div>

        </div>

        {/* Actions Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-col sm:flex-row gap-2 justify-end">
          <button
            type="button"
            onClick={() => handleApply('replace')}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Remplacer la sélection
          </button>
          
          <button
            type="button"
            onClick={() => handleApply('add')}
            className="px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            Ajouter {contactsCount} contacts à la sélection
          </button>
        </div>

      </div>
    </div>
  );
};
