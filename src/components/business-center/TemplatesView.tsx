import React, { useState, useEffect } from 'react';
import { 
  FileText, Plus, Eye, Check, Sparkles, Copy, AlertCircle, 
  HelpCircle, UserCheck, ShieldCheck, Tag
} from 'lucide-react';
import { MessageTemplate, CrmContact } from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

export const TemplatesView: React.FC = () => {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [selectedTestContactId, setSelectedTestContactId] = useState<string>('');
  const [previewText, setPreviewText] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);

  // Form State
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Prospection');
  const [formContent, setFormContent] = useState('');
  const [formCivilityMode, setFormCivilityMode] = useState<'smart' | 'strict' | 'neutral'>('smart');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [tList, cList] = await Promise.all([
        businessCenterApi.getTemplates(),
        businessCenterApi.getCrmContacts()
      ]);
      setTemplates(tList);
      setContacts(cList);
      if (tList.length > 0 && !selectedTemplate) {
        selectTemplate(tList[0]);
      }
      if (cList.length > 0) {
        setSelectedTestContactId(cList[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const selectTemplate = (tmpl: MessageTemplate) => {
    setSelectedTemplate(tmpl);
    setFormName(tmpl.name);
    setFormCategory(tmpl.category);
    setFormContent(tmpl.content);
    setFormCivilityMode(tmpl.civility_mode || 'smart');
    setIsEditing(false);
    updatePreview(tmpl.content, selectedTestContactId || contacts[0]?.id);
  };

  const updatePreview = async (content: string, contactId?: string) => {
    try {
      const res = await businessCenterApi.previewTemplate(undefined, content, contactId);
      setPreviewText(res.resolvedText);
    } catch (err) {
      console.error(err);
    }
  };

  const handleInsertVariable = (varName: string) => {
    setFormContent(prev => prev + ` {{${varName}}} `);
    if (!isEditing) setIsEditing(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formContent.trim()) return;
    try {
      const saved = await businessCenterApi.saveTemplate({
        id: selectedTemplate?.id,
        name: formName.trim(),
        category: formCategory.trim(),
        content: formContent.trim(),
        civility_mode: formCivilityMode,
        variables: ['salutation', 'first_name', 'company_name', 'city', 'product_name', 'tracking_link'],
        conditions: []
      });
      setIsEditing(false);
      await loadData();
      selectTemplate(saved);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateNew = () => {
    setSelectedTemplate(null);
    setFormName('Nouveau Template');
    setFormCategory('Prospection');
    setFormContent('{{salutation}}\n\nNous vous contactons concernant {{product_name}}.\n\nRetrouvez tous les détails ici : {{tracking_link}}\n\nCordialement,\nSTE DigiWare');
    setFormCivilityMode('smart');
    setIsEditing(true);
    updatePreview('{{salutation}}\n\nNous vous contactons concernant {{product_name}}.\n\nRetrouvez tous les détails ici : {{tracking_link}}\n\nCordialement,\nSTE DigiWare');
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            Gestionnaire de Templates & Civilités Professionnelles
          </h2>
          <p className="text-xs text-slate-400">
            Personnalisation individuelle poussée, salutations respectueuses (Maître, Docteur, Monsieur, Madame) sans inférence abusive de genre.
          </p>
        </div>

        <button
          onClick={handleCreateNew}
          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md self-start md:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Créer un Template</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Liste des templates à gauche */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1 mb-2">
            Templates Enregistrés ({templates.length})
          </h3>

          <div className="space-y-2">
            {templates.map(tmpl => {
              const isSelected = selectedTemplate?.id === tmpl.id;
              return (
                <div
                  key={tmpl.id}
                  onClick={() => selectTemplate(tmpl)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border-emerald-500 shadow-md'
                      : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-xs font-bold text-slate-100 truncate pr-2">
                      {tmpl.name}
                    </h4>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                      {tmpl.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2">
                    {tmpl.content}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Éditeur et variables au centre */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Éditeur de Modèle
            </h3>
            {isEditing && (
              <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded">
                Modifications non enregistrées
              </span>
            )}
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Nom du template</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => { setFormName(e.target.value); setIsEditing(true); }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Catégorie</label>
                <input
                  type="text"
                  value={formCategory}
                  onChange={(e) => { setFormCategory(e.target.value); setIsEditing(true); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Règle de Civilité</label>
                <select
                  value={formCivilityMode}
                  onChange={(e) => { setFormCivilityMode(e.target.value as any); setIsEditing(true); }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="smart">Intelligente (Titre pro & Civilité)</option>
                  <option value="neutral">Neutre stricte (Bonjour Prénom,)</option>
                  <option value="strict">Formelle stricte</option>
                </select>
              </div>
            </div>

            {/* Insertion de variables en 1-clic */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1.5 font-bold">
                Variables disponibles (cliquer pour insérer) :
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { tag: 'salutation', label: 'Civilité Intelligente', desc: 'Bonjour Maître Ben Amor, / Bonjour Monsieur Trabelsi,' },
                  { tag: 'first_name', label: 'Prénom' },
                  { tag: 'last_name', label: 'Nom' },
                  { tag: 'company_name', label: 'Entreprise' },
                  { tag: 'profession', label: 'Profession' },
                  { tag: 'city', label: 'Ville' },
                  { tag: 'product_name', label: 'Produit WC' },
                  { tag: 'tracking_link', label: 'Lien Court OmniTracker' }
                ].map((v) => (
                  <button
                    key={v.tag}
                    type="button"
                    onClick={() => handleInsertVariable(v.tag)}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded text-[11px] font-mono cursor-pointer transition-colors"
                    title={v.desc || v.label}
                  >
                    +{`{{${v.tag}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Corps du message WhatsApp</label>
              <textarea
                rows={9}
                value={formContent}
                onChange={(e) => {
                  setFormContent(e.target.value);
                  setIsEditing(true);
                  updatePreview(e.target.value, selectedTestContactId);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 font-mono text-xs leading-relaxed focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <button
              onClick={handleSave}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-xs transition-all shadow-md cursor-pointer"
            >
              Enregistrer le Template
            </button>
          </div>
        </div>

        {/* Aperçu en temps réel à droite avec un contact réel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              Aperçu en Direct Résolu
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                Tester avec un contact réel du CRM :
              </label>
              <select
                value={selectedTestContactId}
                onChange={(e) => {
                  setSelectedTestContactId(e.target.value);
                  updatePreview(formContent, e.target.value);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 text-xs"
              >
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.civility !== 'Non spécifié' ? `${c.civility} ` : ''}{c.first_name} {c.last_name} ({c.profession || c.company_name || c.phone})
                  </option>
                ))}
              </select>
            </div>

            {/* Bulle WhatsApp de rendu réel */}
            <div className="p-4 bg-emerald-950/40 border border-emerald-700/50 rounded-2xl text-slate-100 shadow-inner relative">
              <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Rendu Final WhatsApp :</span>
                <span>Résolution Serveur</span>
              </div>
              <p className="text-xs font-sans whitespace-pre-wrap leading-relaxed">
                {previewText || 'Aperçu du message résolu...'}
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1 text-slate-400 text-[11px]">
              <span className="font-bold text-slate-300 block">Règles éthiques appliquées :</span>
              <p>• Aucune supposition de genre (pas de "Monsieur" ou "Madame" inventé si non certifié dans le CRM).</p>
              <p>• Respect absolu du titre professionnel (ex: Maître pour les avocats).</p>
              <p>• Les variables sont résolues dans WordPress AVANT transmission au WhatsApp Sender.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
