import React, { useState, useEffect } from 'react';
import { 
  Search, Send, CheckCheck, Clock, AlertCircle, Sparkles, User, Tag, 
  Building, Phone, Mail, MapPin, ShoppingBag, Eye, Plus, MessageSquare, 
  Check, RefreshCw, ChevronRight, FileText, CornerDownRight, ShieldCheck, 
  HelpCircle, UserCheck, AlertTriangle
} from 'lucide-react';
import { 
  BusinessConversation, 
  ConversationMessage, 
  CrmContact, 
  MessageTemplate,
  CivilityType
} from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

interface ConversationsViewProps {
  onNavigateToTemplates?: () => void;
  onNavigateToCrm?: () => void;
}

export const ConversationsView: React.FC<ConversationsViewProps> = () => {
  const [conversations, setConversations] = useState<BusinessConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<BusinessConversation | null>(null);
  const [contact, setContact] = useState<CrmContact | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tagFilter, setTagFilter] = useState('ALL');

  // Composer
  const [messageText, setMessageText] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // AI Suggestion
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [isLoadingSuggestion, setIsLoadingSuggestion] = useState(false);

  // Notes
  const [newNoteText, setNewNoteText] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  // Quick edit CRM state
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editCivility, setEditCivility] = useState<CivilityType>('Non spécifié');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editProfession, setEditProfession] = useState('');
  const [newTagInput, setNewTagInput] = useState('');

  // 1. Load conversations & templates
  useEffect(() => {
    loadConversations();
    loadTemplates();
  }, [searchQuery, statusFilter, tagFilter]);

  const loadConversations = async () => {
    try {
      const list = await businessCenterApi.getConversations({
        search: searchQuery || undefined,
        status: statusFilter,
        tag: tagFilter
      });
      setConversations(list);
      if (list.length > 0 && !selectedConvId) {
        selectConversation(list[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadTemplates = async () => {
    try {
      const list = await businessCenterApi.getTemplates();
      setTemplates(list);
    } catch (err) {
      console.error(err);
    }
  };

  // 2. Select conversation and load messages + CRM details
  const selectConversation = async (convId: string) => {
    setSelectedConvId(convId);
    setSendError(null);
    setAiSuggestion(null);
    try {
      const details = await businessCenterApi.getConversationDetails(convId);
      setSelectedConv(details.conversation);
      setContact(details.contact);
      setMessages(details.messages);

      // Populate quick edit form
      if (details.contact) {
        setEditCivility(details.contact.civility || 'Non spécifié');
        setEditFirstName(details.contact.first_name || '');
        setEditLastName(details.contact.last_name || '');
        setEditCompany(details.contact.company_name || '');
        setEditProfession(details.contact.profession || '');
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  // 3. Handle template selection in composer
  const handleSelectTemplate = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    try {
      const preview = await businessCenterApi.previewTemplate(templateId, undefined, contact?.id);
      setMessageText(preview.resolvedText);
    } catch (err) {
      console.error(err);
    }
  };

  // 4. Send message directly to WhatsApp Sender
  const handleSendMessage = async () => {
    if (!selectedConvId || !messageText.trim() || isSending) return;
    setIsSending(true);
    setSendError(null);

    try {
      const result = await businessCenterApi.sendMessage(selectedConvId, messageText);
      setMessages(prev => [...prev, result.message]);
      setMessageText('');
      setSelectedTemplateId('');
      setAiSuggestion(null);

      // Refresh conversations list to update snippet
      loadConversations();
    } catch (err: any) {
      setSendError(err.message || 'Erreur lors de la transmission');
    } finally {
      setIsSending(false);
    }
  };

  // 5. Request AI Suggestion
  const handleGetAiSuggestion = async () => {
    if (!selectedConvId) return;
    setIsLoadingSuggestion(true);
    try {
      const res = await businessCenterApi.getAiSuggestion(selectedConvId);
      setAiSuggestion(res.suggestion);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingSuggestion(false);
    }
  };

  const handleApplySuggestion = () => {
    if (aiSuggestion) {
      setMessageText(aiSuggestion);
      setAiSuggestion(null);
    }
  };

  // 6. Add CRM Note
  const handleAddNote = async () => {
    if (!contact?.id || !newNoteText.trim() || isAddingNote) return;
    setIsAddingNote(true);
    try {
      await businessCenterApi.addContactNote(contact.id, newNoteText.trim(), 'Opérateur');
      setNewNoteText('');
      // Reload contact
      const updated = await businessCenterApi.getCrmContact(contact.id);
      setContact(updated);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAddingNote(false);
    }
  };

  // 7. Save CRM quick edits
  const handleSaveContactEdits = async () => {
    if (!contact?.id) return;
    try {
      const updated = await businessCenterApi.saveCrmContact({
        id: contact.id,
        phone: contact.phone,
        civility: editCivility,
        first_name: editFirstName,
        last_name: editLastName,
        company_name: editCompany,
        profession: editProfession
      });
      setContact(updated);
      setIsEditingContact(false);
      loadConversations();
    } catch (err) {
      console.error(err);
    }
  };

  // 8. Add Tag
  const handleAddTag = async () => {
    if (!contact?.id || !newTagInput.trim()) return;
    const cleanTag = newTagInput.trim();
    if (contact.tags.includes(cleanTag)) {
      setNewTagInput('');
      return;
    }
    const updatedTags = [...contact.tags, cleanTag];
    try {
      const updated = await businessCenterApi.saveCrmContact({
        id: contact.id,
        phone: contact.phone,
        tags: updatedTags
      });
      setContact(updated);
      setNewTagInput('');
      loadConversations();
    } catch (err) {
      console.error(err);
    }
  };

  // 9. Remove Tag
  const handleRemoveTag = async (tagToRemove: string) => {
    if (!contact?.id) return;
    const updatedTags = contact.tags.filter(t => t !== tagToRemove);
    try {
      const updated = await businessCenterApi.saveCrmContact({
        id: contact.id,
        phone: contact.phone,
        tags: updatedTags
      });
      setContact(updated);
      loadConversations();
    } catch (err) {
      console.error(err);
    }
  };

  // 10. Update Conversation Status
  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedConvId) return;
    try {
      await businessCenterApi.updateConversationStatus(selectedConvId, newStatus);
      if (selectedConv) {
        setSelectedConv({ ...selectedConv, status: newStatus as any });
      }
      loadConversations();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex h-[calc(100vh-140px)] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* ========================================================================= */}
      {/* ZONE GAUCHE : LISTE DES CONVERSATIONS                                     */}
      {/* ========================================================================= */}
      <div className="w-80 md:w-96 flex flex-col border-r border-slate-800 bg-slate-950/60 shrink-0">
        {/* En-tête recherche & filtres */}
        <div className="p-3.5 border-b border-slate-800/80 space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Rechercher conversation, contact..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900/90 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
            {['ALL', 'OPEN', 'PENDING', 'HUMAN_NEEDED', 'RESOLVED'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-all cursor-pointer ${
                  statusFilter === st
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {st === 'ALL' && 'Toutes'}
                {st === 'OPEN' && 'Ouvertes'}
                {st === 'PENDING' && 'En attente'}
                {st === 'HUMAN_NEEDED' && '⚠️ Action Humaine'}
                {st === 'RESOLVED' && 'Résolues'}
              </button>
            ))}
          </div>
        </div>

        {/* Liste défilante des conversations */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Aucune conversation trouvée
            </div>
          ) : (
            conversations.map(conv => {
              const isSelected = conv.id === selectedConvId;
              const initials = conv.contact_name
                .split(' ')
                .map(n => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase() || 'W';

              return (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border-l-4 border-emerald-500'
                      : 'hover:bg-slate-900/60'
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-emerald-950/70 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs">
                      {initials}
                    </div>
                    {conv.unread_count > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-white font-bold text-[10px] flex items-center justify-center shadow-xs">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h4 className="text-xs font-semibold text-slate-200 truncate">
                        {conv.contact_name}
                      </h4>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 truncate mb-1">
                      {conv.last_message_text || 'Nouvelle conversation'}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        conv.status === 'HUMAN_NEEDED'
                          ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                          : conv.status === 'OPEN'
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                          : conv.status === 'RESOLVED'
                          ? 'bg-slate-800 text-slate-400'
                          : 'bg-blue-950/80 text-blue-300'
                      }`}>
                        {conv.status === 'HUMAN_NEEDED' && 'Action Humaine'}
                        {conv.status === 'OPEN' && 'Ouverte'}
                        {conv.status === 'PENDING' && 'En attente'}
                        {conv.status === 'RESOLVED' && 'Résolue'}
                      </span>

                      {conv.tags.slice(0, 2).map((t, idx) => (
                        <span key={idx} className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ZONE CENTRALE : VÉRITABLE CONVERSATION (WhatsApp Web View)                */}
      {/* ========================================================================= */}
      <div className="flex-1 flex flex-col bg-slate-900 min-w-0">
        {selectedConv ? (
          <>
            {/* Barre d'en-tête de la discussion */}
            <div className="h-14 px-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-300 font-bold text-xs">
                  {selectedConv.contact_name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
                    {selectedConv.contact_name}
                    <span className="text-[10px] text-slate-400 font-mono">
                      {selectedConv.phone}
                    </span>
                  </h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>WhatsApp Web Direct • Connecté</span>
                  </div>
                </div>
              </div>

              {/* Status Selector & AI Suggestion Button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGetAiSuggestion}
                  disabled={isLoadingSuggestion}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-950/60 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/60 flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Générer une réponse avec le catalogue WooCommerce & FAQ"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isLoadingSuggestion ? 'animate-spin' : 'text-indigo-400'}`} />
                  <span>Suggérer Réponse IA</span>
                </button>

                <select
                  value={selectedConv.status}
                  onChange={(e) => handleUpdateStatus(e.target.value)}
                  className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-300 focus:outline-hidden"
                >
                  <option value="OPEN">Ouverte</option>
                  <option value="PENDING">En attente</option>
                  <option value="HUMAN_NEEDED">Action Humaine Requise</option>
                  <option value="RESOLVED">Résolue</option>
                </select>
              </div>
            </div>

            {/* AI Suggestion Banner if generated */}
            {aiSuggestion && (
              <div className="p-3 bg-indigo-950/50 border-b border-indigo-500/30 flex items-start justify-between gap-3 animate-in fade-in">
                <div className="flex items-start gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-0.5">
                      Suggestion IA (Catalogue WooCommerce & Fiche CRM) :
                    </span>
                    <p className="text-xs text-indigo-100 whitespace-pre-wrap font-sans">
                      {aiSuggestion}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleApplySuggestion}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Insérer
                  </button>
                  <button
                    onClick={() => setAiSuggestion(null)}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs"
                  >
                    Ignorer
                  </button>
                </div>
              </div>
            )}

            {/* Messages discussion list */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[radial-gradient(#1e293b_1px,transparent_1px)] bg-[size:16px_16px]">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                  <MessageSquare className="w-10 h-10 mb-2 opacity-30 text-emerald-500" />
                  <p>Aucun message échangé pour l'instant.</p>
                  <p className="text-[11px] text-slate-600">Rédigez un message ci-dessous pour démarrer la discussion.</p>
                </div>
              ) : (
                messages.map(m => {
                  const isOutbound = m.direction === 'OUTBOUND';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl p-3 shadow-md text-xs leading-relaxed relative ${
                          isOutbound
                            ? 'bg-emerald-900/80 text-emerald-50 border border-emerald-700/60 rounded-tr-none'
                            : 'bg-slate-800 text-slate-100 border border-slate-700/80 rounded-tl-none'
                        }`}
                      >
                        {/* Auteur */}
                        <div className="flex items-center justify-between gap-3 text-[10px] mb-1 font-semibold opacity-75">
                          <span>
                            {isOutbound 
                              ? (m.sender_type === 'AI' ? '🤖 Assistant IA' : '👤 Opérateur DigiWare')
                              : (contact?.first_name || 'Client WhatsApp')}
                          </span>
                          {m.external_message_id && (
                            <span className="font-mono text-[9px] text-emerald-300/80">
                              {m.external_message_id.substring(0, 15)}...
                            </span>
                          )}
                        </div>

                        {/* Corps du message */}
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>

                        {/* Pied du message : statut & horodatage */}
                        <div className="flex items-center justify-end gap-1.5 mt-1.5 text-[10px] opacity-70">
                          <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isOutbound && (
                            <span>
                              {m.status === 'DELIVERED' && <CheckCheck className="w-3.5 h-3.5 text-emerald-300 inline" title="Délivré sur WhatsApp" />}
                              {m.status === 'READ' && <CheckCheck className="w-3.5 h-3.5 text-blue-400 inline" title="Lu par le destinataire" />}
                              {m.status === 'SENT' && <Check className="w-3.5 h-3.5 text-slate-300 inline" title="Envoyé" />}
                              {m.status === 'PENDING' && <Clock className="w-3 h-3 text-amber-300 inline animate-spin" title="En cours de transmission" />}
                              {m.status === 'FAILED' && <AlertCircle className="w-3.5 h-3.5 text-rose-400 inline" title={m.error_message || 'Échec'} />}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Message d'erreur s'il a échoué */}
                      {m.status === 'FAILED' && m.error_message && (
                        <span className="text-[10px] text-rose-400 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {m.error_message}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Zone d'envoi et de rédaction */}
            <div className="p-3 border-t border-slate-800 bg-slate-950/90 space-y-2 shrink-0">
              {/* Sélecteur de Template & Variables rapides */}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-1">
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleSelectTemplate(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-hidden"
                  >
                    <option value="">Sélectionner un template pré-configuré...</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>

                  <button
                    onClick={() => setMessageText(prev => prev + ' {{salutation}} ')}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition-colors"
                    title="Insérer salutation professionnelle respectueuse (ex: Bonjour Maître Ben Amor,)"
                  >
                    + Salutation Civilité
                  </button>
                  <button
                    onClick={() => setMessageText(prev => prev + ' {{tracking_link}} ')}
                    className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition-colors"
                  >
                    + Lien Court
                  </button>
                </div>
              </div>

              {/* Champ texte */}
              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  placeholder={`Écrire à ${selectedConv.contact_name}... (Envoi réel via WhatsApp Web)`}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 resize-none transition-colors"
                />

                <button
                  onClick={handleSendMessage}
                  disabled={isSending || !messageText.trim()}
                  className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-emerald-950/50 shrink-0"
                >
                  {isSending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Envoyer</span>
                    </>
                  )}
                </button>
              </div>

              {sendError && (
                <div className="p-2 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300 text-[11px] flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{sendError}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
            <MessageSquare className="w-12 h-12 mb-3 opacity-20 text-slate-400" />
            <p>Sélectionnez une conversation à gauche pour commencer.</p>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ZONE DROITE : FICHE CRM CONTEXTUELLE BIDIRECTIONNELLE                      */}
      {/* ========================================================================= */}
      <div className="w-80 md:w-88 border-l border-slate-800 bg-slate-950/60 flex flex-col shrink-0 overflow-y-auto">
        {contact ? (
          <div className="p-4 space-y-4">
            {/* En-tête profil */}
            <div className="text-center pb-3 border-b border-slate-800">
              <div className="w-14 h-14 rounded-full bg-emerald-950/80 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-300 font-bold text-base mx-auto mb-2 shadow-lg">
                {contact.first_name ? contact.first_name.charAt(0) : (contact.company_name?.charAt(0) || 'C')}
              </div>
              <h3 className="text-xs font-bold text-slate-100">
                {contact.civility && contact.civility !== 'Non spécifié' ? `${contact.civility} ` : ''}
                {contact.first_name} {contact.last_name}
              </h3>
              <p className="text-[11px] text-slate-400">{contact.profession || contact.company_name || 'Prospect'}</p>

              {/* Status badge */}
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-200">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  contact.status === 'CLIENT' ? 'bg-emerald-400' : 'bg-blue-400'
                }`} />
                <span>{contact.status}</span>
              </div>
            </div>

            {/* Quick Edit Toggle */}
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">Identité & Civilité</span>
              <button
                onClick={() => setIsEditingContact(!isEditingContact)}
                className="text-[10px] text-emerald-400 hover:text-emerald-300 underline"
              >
                {isEditingContact ? 'Annuler' : 'Modifier'}
              </button>
            </div>

            {isEditingContact ? (
              <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl space-y-2 text-xs">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Civilité / Titre</label>
                  <select
                    value={editCivility}
                    onChange={(e) => setEditCivility(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
                  >
                    <option value="Non spécifié">Non spécifié (Neutre)</option>
                    <option value="Monsieur">Monsieur</option>
                    <option value="Madame">Madame</option>
                    <option value="Maître">Maître (Avocat, Notaire)</option>
                    <option value="Docteur">Docteur (Médecin)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Prénom & Nom</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      placeholder="Prénom"
                      value={editFirstName}
                      onChange={(e) => setEditFirstName(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Nom"
                      value={editLastName}
                      onChange={(e) => setEditLastName(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Entreprise</label>
                  <input
                    type="text"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Profession</label>
                  <input
                    type="text"
                    value={editProfession}
                    onChange={(e) => setEditProfession(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
                  />
                </div>
                <button
                  onClick={handleSaveContactEdits}
                  className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold"
                >
                  Sauvegarder dans le CRM
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-mono">{contact.phone}</span>
                </div>
                {contact.email && (
                  <div className="flex items-center gap-2 truncate">
                    <Mail className="w-3.5 h-3.5 text-slate-500" />
                    <span className="truncate">{contact.email}</span>
                  </div>
                )}
                {contact.company_name && (
                  <div className="flex items-center gap-2">
                    <Building className="w-3.5 h-3.5 text-slate-500" />
                    <span>{contact.company_name}</span>
                  </div>
                )}
                {contact.city && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    <span>{contact.city}</span>
                  </div>
                )}
              </div>
            )}

            {/* Tags & Segments */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">Tags & Étiquettes</span>
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map((t, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded flex items-center gap-1"
                  >
                    <span>{t}</span>
                    <button
                      onClick={() => handleRemoveTag(t)}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Ajouter tag..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                />
                <button
                  onClick={handleAddTag}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
                >
                  +
                </button>
              </div>
            </div>

            {/* WooCommerce Orders */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5 text-indigo-400" />
                Commandes WooCommerce
              </span>
              {contact.woocommerce_orders.length === 0 ? (
                <p className="text-[11px] text-slate-500">Aucune commande enregistrée.</p>
              ) : (
                <div className="space-y-1.5">
                  {contact.woocommerce_orders.map(ord => (
                    <div key={ord.id} className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-[11px]">
                      <div className="flex items-center justify-between font-semibold text-slate-200">
                        <span>{ord.number}</span>
                        <span className="text-emerald-400">{ord.total}</span>
                      </div>
                      <p className="text-slate-400 text-[10px]">{ord.products.join(', ')}</p>
                      <span className="text-[9px] text-slate-500">{ord.date} • {ord.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* OmniTracker Events */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-cyan-400" />
                Événements OmniTracker
              </span>
              {contact.omnitracker_events.length === 0 ? (
                <p className="text-[11px] text-slate-500">Aucun clic ou événement récent.</p>
              ) : (
                <div className="space-y-1.5">
                  {contact.omnitracker_events.map(ev => (
                    <div key={ev.id} className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-[10px]">
                      <span className="font-bold text-cyan-300 block">{ev.event_name}</span>
                      <p className="text-slate-400">{ev.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notes internes */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">Notes Internes</span>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {contact.notes.map(n => (
                  <div key={n.id} className="p-2 bg-slate-900/90 border border-slate-800/80 rounded-lg text-[11px]">
                    <div className="flex items-center justify-between text-[9px] text-slate-500 mb-0.5">
                      <span>{n.author}</span>
                      <span>{new Date(n.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-slate-300">{n.content}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-end gap-1.5 pt-1">
                <textarea
                  rows={2}
                  placeholder="Ajouter une note interne..."
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden"
                />
                <button
                  onClick={handleAddNote}
                  disabled={isAddingNote || !newNoteText.trim()}
                  className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-slate-500 text-xs">
            Sélectionnez une conversation pour afficher la fiche CRM.
          </div>
        )}
      </div>
    </div>
  );
};
