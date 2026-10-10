import React, { useState } from 'react';
import { 
  HardDrive, Bookmark, Save, Trash2, Clock, 
  FileText, Check, AlertCircle, ArrowUpRight, FolderOpen, RefreshCw, X 
} from 'lucide-react';
import { SavedWhatsAppSession, saveWhatsAppSessionToMemory, deleteSavedWhatsAppSession } from '../memory';
import { exportWhatsAppToCSV, exportWhatsAppToExcel, exportWhatsAppToVCF } from '../utils';
import { WhatsAppContactRecord, WhatsAppExtractionStats, WhatsAppFileAnalysis } from '../types';

interface WhatsAppMemoryManagerProps {
  isOpen: boolean;
  onClose: () => void;
  currentSession: {
    uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
    rawPasteText: string;
    contacts: WhatsAppContactRecord[];
    stats: WhatsAppExtractionStats | null;
    fileAnalysis: WhatsAppFileAnalysis | null;
  };
  savedSessions: SavedWhatsAppSession[];
  onLoadSession: (session: SavedWhatsAppSession) => void;
  onUpdateSavedSessions: (updated: SavedWhatsAppSession[]) => void;
  onClearCurrentSession: () => void;
}

export const WhatsAppMemoryManager: React.FC<WhatsAppMemoryManagerProps> = ({
  isOpen,
  onClose,
  currentSession,
  savedSessions,
  onLoadSession,
  onUpdateSavedSessions,
  onClearCurrentSession
}) => {
  const [sessionName, setSessionName] = useState<string>('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = saveWhatsAppSessionToMemory(sessionName, currentSession);
    onUpdateSavedSessions(updated);
    setSessionName('');
    setSaveSuccessMsg("Session WhatsApp sauvegardée avec succès !");
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Voulez-vous vraiment supprimer cette sauvegarde WhatsApp ?")) {
      const updated = deleteSavedWhatsAppSession(id);
      onUpdateSavedSessions(updated);
    }
  };

  const hasCurrentData = currentSession.contacts.length > 0 || currentSession.uploadedFiles.length > 0 || currentSession.rawPasteText.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div 
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden my-8 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-emerald-950 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-900 rounded-lg text-emerald-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                Gestionnaire de Mémoire WhatsApp
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-emerald-800 text-emerald-300 rounded-full">
                  Local
                </span>
              </h3>
              <p className="text-xs text-emerald-300">Sauvegardez vos extractions de numéros tunisiens</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 text-emerald-300 hover:text-white hover:bg-emerald-900 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* Section 1: Save current workspace */}
          <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4">
            <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-emerald-600" />
              Créer un point de sauvegarde
            </h4>
            <p className="text-xs text-slate-600 mb-3">
              Enregistre l'état actuel de votre analyse WhatsApp ({currentSession.contacts.length} numéros extraits, {currentSession.uploadedFiles.length} fichiers).
            </p>

            {saveSuccessMsg && (
              <div className="mb-3 p-2.5 bg-emerald-100 text-emerald-800 text-xs font-medium rounded-lg flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-700" />
                {saveSuccessMsg}
              </div>
            )}

            <form onSubmit={handleSaveCurrent} className="flex gap-2">
              <input 
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Ex: Campagne Mars 2026 - Ooredoo & Orange..."
                className="flex-1 text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
              />
              <button
                type="submit"
                disabled={!hasCurrentData}
                className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                  hasCurrentData 
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                Sauvegarder
              </button>
            </form>
          </div>

          {/* Section 2: Saved sessions list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-600" />
                Sauvegardes Enregistrées ({savedSessions.length})
              </h4>
              {hasCurrentData && (
                <button
                  onClick={() => {
                    if (confirm("Voulez-vous vider l'espace de travail WhatsApp actuel ?")) {
                      onClearCurrentSession();
                      onClose();
                    }
                  }}
                  className="text-xs text-rose-600 hover:text-rose-700 font-medium hover:underline"
                >
                  Vider l'espace actuel
                </button>
              )}
            </div>

            {savedSessions.length === 0 ? (
              <div className="text-center py-8 px-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <FolderOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-medium text-slate-600">Aucune sauvegarde enregistrée</p>
                <p className="text-[11px] text-slate-400 mt-1">Vos points de sauvegarde WhatsApp apparaîtront ici.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {savedSessions.map((session) => (
                  <div 
                    key={session.id}
                    className="p-3.5 border border-slate-200 rounded-xl hover:border-emerald-300 hover:bg-emerald-50/30 transition-all flex items-center justify-between gap-3 group bg-white shadow-2xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 truncate block">
                          {session.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 font-medium">
                        <span>{new Date(session.timestamp).toLocaleDateString('fr-FR')} {new Date(session.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>•</span>
                        <span className="text-emerald-700 font-semibold">{session.contacts.length} numéros</span>
                        {session.uploadedFiles && session.uploadedFiles.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{session.uploadedFiles.length} fichier(s)</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          onLoadSession(session);
                          onClose();
                        }}
                        className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 transition-all shadow-xs cursor-pointer"
                        title="Restaurer ce travail"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        Charger
                      </button>

                      {session.contacts.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            exportWhatsAppToCSV(session.contacts, `${session.name.replace(/\s+/g, '_')}.csv`);
                          }}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all"
                          title="Télécharger en CSV"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                        title="Supprimer la sauvegarde"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-between items-center text-xs text-slate-500 shrink-0">
          <span>Toutes les données sont conservées localement dans votre navigateur.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-medium rounded-lg transition-all cursor-pointer shadow-2xs"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
