import React, { useState } from 'react';
import { 
  HardDrive, Bookmark, Save, Trash2, Clock, 
  FileText, Check, AlertCircle, ArrowUpRight, FolderOpen, RefreshCw, X 
} from 'lucide-react';
import { SavedSession, saveSessionToMemory, deleteSavedSession } from '../memory';
import { exportToCSV, exportToExcel } from '../utils';

interface MemoryManagerProps {
  isOpen: boolean;
  onClose: () => void;
  currentSession: {
    uploadedFiles: { name: string; size: number; content: string; status: 'success' | 'error' }[];
    rawPasteText: string;
    contacts: any[];
    stats: any | null;
    fileAnalysis: any | null;
  };
  savedSessions: SavedSession[];
  onLoadSession: (session: SavedSession) => void;
  onUpdateSavedSessions: (updated: SavedSession[]) => void;
  onClearCurrentSession: () => void;
}

export const MemoryManager: React.FC<MemoryManagerProps> = ({
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
    const updated = saveSessionToMemory(sessionName, currentSession);
    onUpdateSavedSessions(updated);
    setSessionName('');
    setSaveSuccessMsg("Travail sauvegardé avec succès dans la mémoire locale !");
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Voulez-vous vraiment supprimer cette sauvegarde de la mémoire ?")) {
      const updated = deleteSavedSession(id);
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
        <div className="bg-slate-950 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-lg text-emerald-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                Mémoire & Historique des Travaux
                <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded-full border border-slate-700">
                  {savedSessions.length} enregistrée(s)
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Sauvegardez vos listes et fichiers pour ne plus avoir à les recharger.
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

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          
          {/* Quick Save Current Session Form */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Save className="w-4 h-4 text-slate-600" />
                Sauvegarder le travail en cours
              </span>
              <span className="text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Sauvegarde automatique active
              </span>
            </div>

            {hasCurrentData ? (
              <form onSubmit={handleSaveCurrent} className="flex gap-2">
                <input 
                  type="text"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder={`Nom de la sauvegarde (ex: Prospects ${new Date().toLocaleDateString('fr-FR')})`}
                  className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950"
                />
                <button
                  type="submit"
                  className="bg-slate-950 text-white hover:bg-slate-900 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer shadow-xs"
                >
                  <Bookmark className="w-3 h-3 text-emerald-400" />
                  Mémoriser
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-500 italic">
                Aucun fichier ou contact n'est actuellement présent dans votre espace de travail à sauvegarder.
              </p>
            )}

            {saveSuccessMsg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{saveSuccessMsg}</span>
              </div>
            )}
          </div>

          {/* List of Saved Sessions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-500" />
                Sauvegardes mémorisées ({savedSessions.length})
              </h3>
            </div>

            {savedSessions.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 p-6 space-y-2">
                <FolderOpen className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-medium text-slate-600">Aucune mémoire enregistrée pour le moment.</p>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Lorsque vous extrayez des contacts ou déposez des fichiers, cliquez sur "Mémoriser" pour conserver votre travail de manière permanente.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {savedSessions.map((session) => (
                  <div 
                    key={session.id}
                    className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 truncate">
                          {session.name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          {new Date(session.timestamp).toLocaleDateString('fr-FR')} {new Date(session.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                        <span className="font-semibold text-slate-700 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-md">
                          {session.contacts.length} contact(s) extrait(s)
                        </span>
                        {session.uploadedFiles.length > 0 && (
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5 text-slate-400" />
                            {session.uploadedFiles.length} fichier(s)
                          </span>
                        )}
                        {session.rawPasteText.trim() && (
                          <span className="text-slate-400 italic">
                            + texte collé
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        onClick={() => {
                          onLoadSession(session);
                          onClose();
                        }}
                        className="bg-slate-950 text-white hover:bg-slate-900 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                        Charger ce travail
                      </button>

                      {session.contacts.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            exportToCSV(session.contacts, `contacts_${session.name.replace(/\s+/g, '_')}.csv`);
                          }}
                          title="Exporter CSV direct"
                          className="p-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg transition-all cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={(e) => handleDelete(session.id, e)}
                        title="Supprimer cette sauvegarde"
                        className="p-2 border border-slate-200 hover:border-rose-200 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
          <div className="flex items-center gap-2">
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
            <span>Stockage local du navigateur (HTML5 Web Storage)</span>
          </div>
          <button
            onClick={() => {
              if (confirm("Voulez-vous réinitialiser l'espace de travail actuel ?")) {
                onClearCurrentSession();
                onClose();
              }
            }}
            className="text-rose-600 hover:text-rose-700 font-semibold cursor-pointer"
          >
            Réinitialiser l'espace de travail
          </button>
        </div>

      </div>
    </div>
  );
};
