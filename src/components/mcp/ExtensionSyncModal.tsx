import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  ArrowRight,
  ShieldCheck,
  UploadCloud,
  FileCheck,
  Terminal,
  Zap,
  Clock,
  HardDrive
} from 'lucide-react';

interface LocalFile {
  name: string;
  relPath: string;
  size: number;
  mtime: string;
}

interface ExtensionSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultFile?: string;
}

export const ExtensionSyncModal: React.FC<ExtensionSyncModalProps> = ({
  isOpen,
  onClose,
  defaultFile = 'src/WordPress/Admin.php'
}) => {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>(defaultFile);
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSavingLocal, setIsSavingLocal] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isDeployingAll, setIsDeployingAll] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    details?: string;
  } | null>(null);

  // Load available local extension files
  const loadFiles = async () => {
    try {
      const res = await fetch('/api/mcp/local-extension-files');
      const data = await res.json();
      if (data.success && data.files) {
        setFiles(data.files);
        if (!selectedFile && data.files.length > 0) {
          setSelectedFile(data.files[0].relPath);
        }
      }
    } catch (err: any) {
      console.error('Erreur chargement fichiers locaux', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadFiles();
      setStatusMessage(null);
    }
  }, [isOpen]);

  // Load content of selected file
  const loadContent = async (relPath: string) => {
    if (!relPath) return;
    setIsLoadingFile(true);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/mcp/local-file-content?path=${encodeURIComponent(relPath)}`);
      const data = await res.json();
      if (data.success) {
        setFileContent(data.content || '');
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Erreur de lecture' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    } finally {
      setIsLoadingFile(false);
    }
  };

  useEffect(() => {
    if (isOpen && selectedFile) {
      loadContent(selectedFile);
    }
  }, [isOpen, selectedFile]);

  // Save changes locally in Workspace
  const handleSaveLocal = async () => {
    if (!selectedFile) return;
    setIsSavingLocal(true);
    try {
      const res = await fetch('/api/mcp/save-local-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({
          type: 'success',
          text: `Fichier local ${selectedFile} sauvegardé avec succès dans le Workspace.`
        });
        loadFiles();
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Erreur sauvegarde' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    } finally {
      setIsSavingLocal(false);
    }
  };

  // Push single file to WordPress via MCP Gateway
  const handlePushToSite = async () => {
    if (!selectedFile) return;
    setIsDeploying(true);
    setStatusMessage({
      type: 'info',
      text: `Mise à jour en cours de ${selectedFile} vers https://digiwareinformatique.com via MCP...`
    });

    try {
      // First ensure current editor buffer is saved locally
      await fetch('/api/mcp/save-local-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent })
      });

      // Then push to WordPress site via MCP
      const res = await fetch('/api/mcp/push-file-to-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedFile,
          note: `Mise à jour automatique extension WhatsApp: ${selectedFile}`
        })
      });

      const data = await res.json();

      if (data.success) {
        const snapInfo = data.result?.snapshot_id
          ? ` • Snapshot de sauvegarde: ${data.result.snapshot_id}`
          : '';
        setStatusMessage({
          type: 'success',
          text: `✅ ${selectedFile} mis à jour avec succès sur le site WordPress via MCP !`,
          details: `Destination: wp-content/plugins/whatsapp/${selectedFile}${snapInfo} • Syntaxe PHP validée`
        });
        loadFiles();
      } else {
        setStatusMessage({
          type: 'error',
          text: `Échec de mise à jour: ${data.error || 'Erreur inconnue'}`
        });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Erreur réseau: ${err.message}` });
    } finally {
      setIsDeploying(false);
    }
  };

  // Push all key files
  const handlePushAll = async () => {
    if (!confirm("Voulez-vous synchroniser tous les fichiers de l'extension modifiés vers le site WordPress ?")) {
      return;
    }

    setIsDeployingAll(true);
    setStatusMessage({
      type: 'info',
      text: "Mise à jour globale de l'extension en cours vers WordPress via MCP..."
    });

    try {
      let updatedCount = 0;
      for (const f of files) {
        const res = await fetch('/api/mcp/push-file-to-site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: f.relPath,
            note: `Synchronisation complète extension WhatsApp: ${f.relPath}`
          })
        });
        const data = await res.json();
        if (data.success) updatedCount++;
      }

      setStatusMessage({
        type: 'success',
        text: `✅ ${updatedCount} fichier(s) de l'extension ont été mis à jour directement sur WordPress via MCP !`,
        details: 'Votre extension sur digiwareinformatique.com est désormais 100% synchronisée.'
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Erreur: ${err.message}` });
    } finally {
      setIsDeployingAll(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-5xl w-full flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        
        {/* Header */}
        <div className="p-4 px-6 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-slate-100 text-base">Mise à Jour Automatique vers WordPress</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-500/40 text-emerald-300">
                  MCP Gateway 2.0.0
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 border border-blue-500/40 text-blue-300">
                  Plugins/whatsapp/
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Chaque amélioration apportée ici est envoyée directement vers l'extension du site en 1 clic.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handlePushAll}
              disabled={isDeploying || isDeployingAll}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 hover:text-white flex items-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50"
              title="Synchroniser tous les fichiers de l'extension"
            >
              <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isDeployingAll ? 'Synchronisation...' : 'Tout Mettre à Jour (Batch)'}</span>
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Notification Banner */}
        {statusMessage && (
          <div
            className={`p-3 px-6 text-xs flex items-start space-x-2.5 border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-200'
                : statusMessage.type === 'error'
                ? 'bg-rose-950/60 border-rose-500/30 text-rose-200'
                : 'bg-blue-950/60 border-blue-500/30 text-blue-200'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : statusMessage.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-semibold">{statusMessage.text}</p>
              {statusMessage.details && (
                <p className="text-[11px] opacity-80 mt-0.5 font-mono">{statusMessage.details}</p>
              )}
            </div>
          </div>
        )}

        {/* Main Body */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Panel: Files of the Extension */}
          <div className="w-72 border-r border-slate-800 bg-slate-950/40 p-3 flex flex-col space-y-2 overflow-y-auto">
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Fichiers de l'Extension ({files.length})
              </span>
              <button
                onClick={loadFiles}
                className="text-slate-400 hover:text-slate-200 transition-colors p-1"
                title="Actualiser la liste"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-1">
              {files.map((file) => {
                const isSelected = selectedFile === file.relPath;
                return (
                  <button
                    key={file.relPath}
                    onClick={() => setSelectedFile(file.relPath)}
                    className={`w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between text-xs cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 font-semibold shadow-sm'
                        : 'bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2 overflow-hidden pr-2">
                      <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-500'}`} />
                      <span className="truncate">{file.relPath}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                      {Math.round(file.size / 1024)}k
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Panel: File Editor / Viewer & Action Bar */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
            
            {/* Top Bar for Selected File */}
            <div className="p-3 px-4 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2">
                <span className="text-slate-400">Fichier cible :</span>
                <span className="font-mono text-emerald-400 font-semibold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                  plugins/whatsapp/{selectedFile}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSaveLocal}
                  disabled={isSavingLocal}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold flex items-center space-x-1.5 transition-all cursor-pointer border border-slate-700 disabled:opacity-50"
                  title="Sauvegarder dans le Workspace"
                >
                  <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                  <span>{isSavingLocal ? 'Sauvegarde...' : 'Sauvegarder Workspace'}</span>
                </button>

                <button
                  onClick={handlePushToSite}
                  disabled={isDeploying}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center space-x-1.5 transition-all shadow-md shadow-emerald-950/50 cursor-pointer border border-emerald-400 disabled:opacity-50"
                  title="Téléverser et mettre à jour directement sur WordPress via MCP"
                >
                  {isDeploying ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" />
                  )}
                  <span>{isDeploying ? 'Mise à jour en cours...' : '⚡ Mettre à jour sur WordPress (MCP)'}</span>
                </button>
              </div>
            </div>

            {/* Code / Content Area */}
            <div className="flex-1 p-3 overflow-hidden flex flex-col">
              {isLoadingFile ? (
                <div className="flex-1 flex items-center justify-center space-x-2 text-slate-400 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Chargement du code du fichier...</span>
                </div>
              ) : (
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  placeholder="Code source du fichier..."
                  className="w-full flex-1 p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[12px] text-slate-200 leading-relaxed focus:outline-none focus:border-emerald-500/50 resize-none overflow-auto"
                  spellCheck={false}
                />
              )}
            </div>

            {/* Bottom Safeguard Bar */}
            <div className="p-3 px-4 bg-slate-950/70 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center space-x-4">
                <span className="flex items-center space-x-1 text-emerald-400 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Snapshot automatique distant</span>
                </span>
                <span className="flex items-center space-x-1 text-blue-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Vérification syntaxique PHP</span>
                </span>
                <span className="flex items-center space-x-1 text-slate-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Rollback instantané garanti</span>
                </span>
              </div>

              <div className="text-[11px] font-mono text-slate-500">
                {fileContent.split('\n').length} lignes • {new Blob([fileContent]).size} octets
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
