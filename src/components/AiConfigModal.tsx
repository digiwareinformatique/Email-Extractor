/**
 * AI Provider Configuration & Switching Modal
 * Supports: Gemini (Default Google AI Studio / Custom), Groq, DeepSeek, OpenAI, Claude, Mistral, Ollama/Local, or 0-Quota Mode
 * STE DigiWare SUARL - Lead Intelligence Architecture
 */
import React, { useState, useEffect } from 'react';
import { 
  X, Sparkles, Zap, Shield, Cpu, Key, Globe, CheckCircle2, 
  AlertTriangle, RefreshCw, Server, ArrowRight, ExternalLink,
  Eye, EyeOff, Check, Flame, ShieldCheck, HelpCircle
} from 'lucide-react';

export interface AiProviderOption {
  id: string;
  name: string;
  defaultModel: string;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  description: string;
  isFreeOrGenerous: boolean;
  keyHelpUrl?: string;
  keyPlaceholder?: string;
}

interface AiConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigUpdated?: (activeProvider: string, activeModel: string) => void;
}

export const AiConfigModal: React.FC<AiConfigModalProps> = ({
  isOpen,
  onClose,
  onConfigUpdated
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  
  const [selectedProvider, setSelectedProvider] = useState<string>('gemini-default');
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('gemini-3.8-flash');
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [hasStoredKey, setHasStoredKey] = useState<boolean>(false);

  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    message: string;
    model?: string;
  } | null>(null);

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const providerDetails: Record<string, { keyHelpUrl?: string; keyPlaceholder?: string }> = {
    'gemini-default': {
      keyPlaceholder: 'Fourni automatiquement par Google AI Studio'
    },
    'groq': {
      keyHelpUrl: 'https://console.groq.com/keys',
      keyPlaceholder: 'gsk_...'
    },
    'deepseek': {
      keyHelpUrl: 'https://platform.deepseek.com/api_keys',
      keyPlaceholder: 'sk-...'
    },
    'openai': {
      keyHelpUrl: 'https://platform.openai.com/api-keys',
      keyPlaceholder: 'sk-proj-...'
    },
    'gemini-custom': {
      keyHelpUrl: 'https://aistudio.google.com/app/apikey',
      keyPlaceholder: 'AIzaSy...'
    },
    'anthropic': {
      keyHelpUrl: 'https://console.anthropic.com/settings/keys',
      keyPlaceholder: 'sk-ant-...'
    },
    'mistral': {
      keyHelpUrl: 'https://console.mistral.ai/api-keys',
      keyPlaceholder: '...'
    },
    'custom-openai': {
      keyPlaceholder: 'Optionnel pour serveurs locaux (ex: http://localhost:11434/v1)'
    }
  };

  const providers: AiProviderOption[] = [
    {
      id: 'gemini-default',
      name: 'Google Gemini (Google AI Studio - Par Défaut)',
      defaultModel: 'gemini-3.8-flash',
      requiresApiKey: false,
      requiresBaseUrl: false,
      description: 'Connecté d\'office avec la clé de votre projet Google AI Studio. Utilise votre quota gratuit journalier (10 000 req/jour).',
      isFreeOrGenerous: true
    },
    {
      id: 'groq',
      name: 'Groq Cloud (Ultra-Rapide & Quota Gratuit Élevé)',
      defaultModel: 'llama-3.3-70b-versatile',
      requiresApiKey: true,
      requiresBaseUrl: false,
      description: 'L\'alternative idéale pour ne pas épuiser votre quota Google. Inférence instantanée avec Llama 3.3 70B.',
      isFreeOrGenerous: true,
      keyHelpUrl: 'https://console.groq.com/keys',
      keyPlaceholder: 'gsk_...'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek (DeepSeek V3 / R1)',
      defaultModel: 'deepseek-chat',
      requiresApiKey: true,
      requiresBaseUrl: false,
      description: 'Modèle de raisonnement de pointe à prix ultra-économique pour les gros volumes de prospection.',
      isFreeOrGenerous: false,
      keyHelpUrl: 'https://platform.deepseek.com/api_keys',
      keyPlaceholder: 'sk-...'
    },
    {
      id: 'openai',
      name: 'OpenAI (ChatGPT / GPT-4o-mini / GPT-4o)',
      defaultModel: 'gpt-4o-mini',
      requiresApiKey: true,
      requiresBaseUrl: false,
      description: 'Modèles officiels OpenAI haute précision (gpt-4o-mini recommandé pour vitesse/coût).',
      isFreeOrGenerous: false,
      keyHelpUrl: 'https://platform.openai.com/api-keys',
      keyPlaceholder: 'sk-proj-...'
    },
    {
      id: 'gemini-custom',
      name: 'Google Gemini (Clé Personnalisée / Payante)',
      defaultModel: 'gemini-2.5-flash',
      requiresApiKey: true,
      requiresBaseUrl: false,
      description: 'Utilisez votre propre clé API Gemini externe (compte GCP pro) pour ne jamais bloquer votre quota AI Studio.',
      isFreeOrGenerous: false,
      keyHelpUrl: 'https://aistudio.google.com/app/apikey',
      keyPlaceholder: 'AIzaSy...'
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude (Claude 3.5 Haiku / Sonnet)',
      defaultModel: 'claude-3-5-haiku-20241022',
      requiresApiKey: true,
      requiresBaseUrl: false,
      description: 'Analyse et extraction de données avec les modèles Claude d\'Anthropic.',
      isFreeOrGenerous: false,
      keyHelpUrl: 'https://console.anthropic.com/settings/keys',
      keyPlaceholder: 'sk-ant-...'
    },
    {
      id: 'mistral',
      name: 'Mistral AI (Mistral Small / Large)',
      defaultModel: 'mistral-small-latest',
      requiresApiKey: true,
      requiresBaseUrl: false,
      description: 'Modèles européens souverains rapides et performants.',
      isFreeOrGenerous: false,
      keyHelpUrl: 'https://console.mistral.ai/api-keys',
      keyPlaceholder: '...'
    },
    {
      id: 'custom-openai',
      name: 'Serveur Local / Ollama / LM Studio (Compatible OpenAI)',
      defaultModel: 'llama3',
      requiresApiKey: false,
      requiresBaseUrl: true,
      description: 'Connectez un modèle tournant en local sur votre machine ou réseau privé sans aucun coût ni quota.',
      isFreeOrGenerous: true,
      keyPlaceholder: 'Optionnel'
    },
    {
      id: 'disabled',
      name: 'Mode 0 Quota (Local & Heuristique Déterministe)',
      defaultModel: 'none',
      requiresApiKey: false,
      requiresBaseUrl: false,
      description: 'Désactive tout appel d\'IA externe. La prospection tourne 100% sur les annuaires publics locaux et regex tunisiennes.',
      isFreeOrGenerous: true
    }
  ];

  // Load current configuration
  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const text = await res.text();
      if (!text || text.trim().startsWith('<')) return;
      const data = JSON.parse(text);
      if (data && data.current) {
        setSelectedProvider(data.current.provider || 'gemini-default');
        setModel(data.current.model || 'gemini-3.8-flash');
        setBaseUrl(data.current.baseUrl || '');
        setApiKey(data.current.apiKeyMasked || '');
        setHasStoredKey(data.current.hasApiKeySet || false);
      }
    } catch (err) {
      console.warn('[AI Config] Initialisation configuration locale.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setTestResult(null);
      setStatusMessage(null);
    }
  }, [isOpen]);

  // When changing provider, set appropriate default model
  const handleSelectProvider = (provId: string) => {
    setSelectedProvider(provId);
    setTestResult(null);
    setStatusMessage(null);
    const target = providers.find(p => p.id === provId);
    if (target) {
      setModel(target.defaultModel);
      if (provId === 'custom-openai' && !baseUrl) {
        setBaseUrl('http://localhost:11434/v1');
      }
      if (provId === 'gemini-default') {
        setApiKey('');
      }
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey,
          model,
          baseUrl
        })
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        message: err.message || 'Échec de communication avec le serveur'
      });
    } finally {
      setTesting(false);
    }
  };

  // Save configuration
  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey,
          model,
          baseUrl
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({ type: 'success', text: 'Configuration IA enregistrée et activée avec succès !' });
        if (onConfigUpdated) {
          onConfigUpdated(selectedProvider, model);
        }
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Erreur lors de la sauvegarde.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const activeProviderObj = providers.find(p => p.id === selectedProvider) || providers[0];

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving && !testing) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-2xl max-w-3xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 my-6 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Gestionnaire des Intelligences Artificielles</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  Multi-Fournisseurs
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Préservez votre quota gratuit Google AI Studio en connectant d'autres IA ou en passant en local
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Clarification Explanation Box */}
          <div className="p-4 bg-indigo-50/70 border border-indigo-200/80 rounded-xl text-xs space-y-2">
            <div className="flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-indigo-950">Clarification Quota & Fonctionnement :</span>
                <p className="text-indigo-900 mt-1 leading-relaxed">
                  L'application utilise <strong>Google Gemini Flash</strong> préconfiguré par défaut avec la clé d'environnement de votre projet Google AI Studio. 
                  Cela consomme effectivement le <strong>quota quotidien gratuit</strong> (10 000 requêtes/jour et limite de jetons). 
                  Pour éviter tout blocage lorsque vous prospectez de gros volumes, vous pouvez librement brancher un autre fournisseur (comme <strong>Groq</strong> gratuit et ultra-rapide, <strong>DeepSeek</strong>, <strong>OpenAI</strong>, un serveur local ou le <strong>Mode 0 Quota</strong>).
                </p>
              </div>
            </div>
          </div>

          {/* Status Message */}
          {statusMessage && (
            <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
              statusMessage.type === 'success' 
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}>
              {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Provider Selection Cards */}
          <div>
            <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-2">
              Choisissez le Moteur d'IA Actif :
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {providers.map((p) => {
                const isSelected = selectedProvider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectProvider(p.id)}
                    className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between cursor-pointer ${
                      isSelected 
                        ? 'border-indigo-600 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-600' 
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-bold ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
                          {p.name.split('(')[0].trim()}
                        </span>
                        {isSelected && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-tight">
                        {p.description}
                      </p>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                      <span className="font-mono text-slate-400 truncate max-w-[130px]">{p.defaultModel}</span>
                      {p.isFreeOrGenerous && (
                        <span className="font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          {p.id === 'disabled' ? '0 Quota' : 'Gratuit'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration Parameters for Selected Provider */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900">Paramètres pour :</span>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                  {activeProviderObj.name}
                </span>
              </div>
              {providerDetails[selectedProvider]?.keyHelpUrl && (
                <a
                  href={providerDetails[selectedProvider].keyHelpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 font-medium"
                >
                  <span>Obtenir une clé API</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* API Key field if needed */}
            {activeProviderObj.requiresApiKey && (
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Clé API {activeProviderObj.name.split('(')[0]} :
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={providerDetails[selectedProvider]?.keyPlaceholder || 'sk-...'}
                    className="w-full px-3 py-2 pr-10 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {hasStoredKey && !apiKey && (
                  <p className="text-[10px] text-emerald-600 mt-1">
                    ✓ Une clé est déjà enregistrée sur le serveur. Laissez vide pour la conserver.
                  </p>
                )}
              </div>
            )}

            {/* Base URL field if needed */}
            {activeProviderObj.requiresBaseUrl && (
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  URL de base du serveur local (ex: Ollama, LM Studio, vLLM) :
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Pour Ollama : lancez <code className="bg-slate-200 px-1 rounded">ollama serve</code> (port par défaut 11434).
                </p>
              </div>
            )}

            {/* Model Name */}
            {selectedProvider !== 'disabled' && (
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Nom du Modèle :
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={activeProviderObj.defaultModel}
                    className="flex-1 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setModel(activeProviderObj.defaultModel)}
                    className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Défaut
                  </button>
                </div>
              </div>
            )}

            {/* Test Connection Button & Result */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-slate-200">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                {testing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                    <span>Test en cours...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>Tester la Connexion</span>
                  </>
                )}
              </button>

              {testResult && (
                <div className={`p-2 rounded-lg text-[11px] flex items-center gap-1.5 ${
                  testResult.success 
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}>
                  {testResult.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  )}
                  <span>
                    {testResult.success ? (
                      <>Connecté ({testResult.latencyMs} ms) • Modèle validé : <strong>{testResult.model}</strong></>
                    ) : (
                      testResult.message
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => handleSelectProvider('gemini-default')}
            className="text-xs text-slate-600 hover:text-slate-900 font-semibold cursor-pointer underline underline-offset-4"
          >
            Rétablir Gemini par défaut
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Enregistrement...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Enregistrer & Activer</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
