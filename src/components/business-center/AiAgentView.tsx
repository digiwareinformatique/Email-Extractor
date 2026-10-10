import React, { useState, useEffect } from 'react';
import { 
  Bot, Sparkles, Shield, Clock, Sliders, Check, AlertCircle, 
  HelpCircle, UserCheck, MessageSquare, ShieldAlert 
} from 'lucide-react';
import { AiAgentConfig, WcProduct } from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

export const AiAgentView: React.FC = () => {
  const [config, setConfig] = useState<AiAgentConfig | null>(null);
  const [products, setProducts] = useState<WcProduct[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [newForbiddenTopic, setNewForbiddenTopic] = useState('');
  const [newHandoffKeyword, setNewHandoffKeyword] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [cfg, pList] = await Promise.all([
        businessCenterApi.getAiConfig(),
        businessCenterApi.getProducts()
      ]);
      setConfig(cfg);
      setProducts(pList);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    try {
      await businessCenterApi.saveAiConfig(config);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleProductPriority = (productId: string) => {
    if (!config) return;
    const exists = config.priority_product_ids.includes(productId);
    const updated = exists
      ? config.priority_product_ids.filter(id => id !== productId)
      : [...config.priority_product_ids, productId];
    setConfig({ ...config, priority_product_ids: updated });
  };

  const handleAddForbiddenTopic = () => {
    if (!config || !newForbiddenTopic.trim()) return;
    setConfig({
      ...config,
      forbidden_topics: [...config.forbidden_topics, newForbiddenTopic.trim()]
    });
    setNewForbiddenTopic('');
  };

  const handleRemoveForbiddenTopic = (topic: string) => {
    if (!config) return;
    setConfig({
      ...config,
      forbidden_topics: config.forbidden_topics.filter(t => t !== topic)
    });
  };

  const handleAddHandoffKeyword = () => {
    if (!config || !newHandoffKeyword.trim()) return;
    setConfig({
      ...config,
      human_handoff_keywords: [...config.human_handoff_keywords, newHandoffKeyword.trim()]
    });
    setNewHandoffKeyword('');
  };

  const handleRemoveHandoffKeyword = (kw: string) => {
    if (!config) return;
    setConfig({
      ...config,
      human_handoff_keywords: config.human_handoff_keywords.filter(k => k !== kw)
    });
  };

  if (!config) return null;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-400" />
            AI Agent — Assistant Commercial Connecté au Site & Catalogue
          </h2>
          <p className="text-xs text-slate-400">
            Configurez les règles de réponse, les sources autorisées (WooCommerce, FAQ) et le transfert vers un opérateur humain.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md self-start md:self-auto cursor-pointer"
        >
          {isSaved ? <Check className="w-4 h-4 text-white" /> : <Sparkles className="w-4 h-4" />}
          <span>{isSaved ? 'Paramètres Enregistrés !' : 'Enregistrer la Configuration'}</span>
        </button>
      </div>

      {/* Mode de Fonctionnement (3 Modes Clairs) */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          1. Mode Opérationnel de l'Agent IA
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {[
            {
              id: 'DISABLED',
              title: '1. Désactivé',
              desc: 'Aucune intervention automatique. Les conversations sont exclusivement traitées par des opérateurs humains.',
              color: 'slate'
            },
            {
              id: 'SUGGESTION',
              title: '2. Suggestion (Recommandé)',
              desc: "L'IA analyse le message client, prépare une réponse contextualisée, mais l'opérateur doit valider d'un clic avant l'envoi.",
              color: 'indigo'
            },
            {
              id: 'AUTO',
              title: '3. Réponse Automatique',
              desc: "L'IA répond automatiquement dans les limites strictes des produits WooCommerce et des règles métier définies.",
              color: 'emerald'
            }
          ].map(mode => (
            <div
              key={mode.id}
              onClick={() => setConfig({ ...config, mode: mode.id as any })}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                config.mode === mode.id
                  ? 'bg-slate-800 border-indigo-500 shadow-md ring-1 ring-indigo-500/50'
                  : 'bg-slate-950/60 border-slate-800 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-bold text-slate-100">{mode.title}</span>
                {config.mode === mode.id && <Check className="w-4 h-4 text-emerald-400" />}
              </div>
              <p className="text-slate-400 text-[11px] leading-relaxed">{mode.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Identité, Langue & Horaires */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 text-xs">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider pb-2 border-b border-slate-800">
            2. Identité & Disponibilité
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Nom public de l'assistant</label>
              <input
                type="text"
                value={config.identity_name}
                onChange={(e) => setConfig({ ...config, identity_name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Tonalité commerciale</label>
                <select
                  value={config.tone}
                  onChange={(e) => setConfig({ ...config, tone: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="professionnel">Professionnel & Courtois</option>
                  <option value="chaleureux">Chaleureux & Accueillant</option>
                  <option value="technique">Précis & Technique</option>
                  <option value="commercial">Orienté Démonstration</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Langue principale</label>
                <select
                  value={config.language}
                  onChange={(e) => setConfig({ ...config, language: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="fr">Français</option>
                  <option value="ar">Arabe (Tunisie)</option>
                  <option value="en">Anglais</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Horaires d'activité (Début)</label>
                <input
                  type="time"
                  value={config.working_hours_start}
                  onChange={(e) => setConfig({ ...config, working_hours_start: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Horaires d'activité (Fin)</label>
                <input
                  type="time"
                  value={config.working_hours_end}
                  onChange={(e) => setConfig({ ...config, working_hours_end: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sources de connaissances autorisées */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 text-xs">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider pb-2 border-b border-slate-800">
            3. Sources de Connaissance Autorisées
          </h3>

          <div className="space-y-2.5">
            {[
              { key: 'woocommerce_products', label: 'Produits, Prix et Tarifs WooCommerce', desc: 'Consulte les tarifs réels sans jamais inventer de prix.' },
              { key: 'woocommerce_faq', label: 'FAQ et Questions Fréquentes Produits', desc: 'Utilise les arguments et réponses documentés.' },
              { key: 'crm_lead_data', label: 'Historique et Fiche CRM du Contact', desc: "Prend en compte la civilité, l'entreprise et les commandes passées." },
              { key: 'site_pages', label: 'Pages et Guides WordPress Publics', desc: "S'appuie sur la documentation et les conditions officielles." }
            ].map(source => (
              <label
                key={source.key}
                className="flex items-start gap-3 p-2.5 bg-slate-950/70 border border-slate-800 rounded-xl cursor-pointer hover:bg-slate-950"
              >
                <input
                  type="checkbox"
                  checked={(config.allowed_sources as any)[source.key]}
                  onChange={(e) => setConfig({
                    ...config,
                    allowed_sources: { ...config.allowed_sources, [source.key]: e.target.checked }
                  })}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-0"
                />
                <div>
                  <span className="font-bold text-slate-200 block text-[11px]">{source.label}</span>
                  <span className="text-[10px] text-slate-400">{source.desc}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Règles de Transfert Humain & Sujets Interdits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Transfert humain */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 text-xs">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-amber-400" />
            Mots-clés Déclenchant le Transfert à un Humain
          </h3>
          <p className="text-slate-400 text-[11px]">
            Dès que le client écrit l'un de ces mots, l'IA suspend ses réponses et passe la conversation en statut <code>Action Humaine</code> :
          </p>

          <div className="flex flex-wrap gap-1.5">
            {config.human_handoff_keywords.map((kw, idx) => (
              <span key={idx} className="bg-amber-950 text-amber-300 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1">
                <span>{kw}</span>
                <button onClick={() => handleRemoveHandoffKeyword(kw)} className="text-amber-500 hover:text-rose-400">×</button>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              placeholder="Ajouter mot-clé (ex: réclamation, responsable)..."
              value={newHandoffKeyword}
              onChange={(e) => setNewHandoffKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddHandoffKeyword()}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-100 text-xs"
            />
            <button
              onClick={handleAddHandoffKeyword}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs"
            >
              +
            </button>
          </div>
        </div>

        {/* Sujets interdits */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 text-xs">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            Sujets et Règles Strictement Interdits
          </h3>
          <p className="text-slate-400 text-[11px]">
            L'IA ne doit en aucun cas négocier de remises non publiées, promettre de conditions contractuelles spéciales :
          </p>

          <div className="flex flex-wrap gap-1.5">
            {config.forbidden_topics.map((top, idx) => (
              <span key={idx} className="bg-rose-950 text-rose-300 border border-rose-500/30 text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1">
                <span>{top}</span>
                <button onClick={() => handleRemoveForbiddenTopic(top)} className="text-rose-500 hover:text-white">×</button>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              placeholder="Ajouter sujet interdit..."
              value={newForbiddenTopic}
              onChange={(e) => setNewForbiddenTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddForbiddenTopic()}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-100 text-xs"
            />
            <button
              onClick={handleAddForbiddenTopic}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
