import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, Users, Layers, FileText, ShoppingBag, Link2, 
  Bot, BarChart2, History, Settings, Smartphone, Wifi, Play, Pause, AlertTriangle, Zap 
} from 'lucide-react';
import { ConversationsView } from './ConversationsView';
import { CrmView } from './CrmView';
import { CampaignsView } from './CampaignsView';
import { TemplatesView } from './TemplatesView';
import { ProductsView } from './ProductsView';
import { LinkCenterView } from './LinkCenterView';
import { AiAgentView } from './AiAgentView';
import { AnalyticsView } from './AnalyticsView';
import { ActivityJournalView } from './ActivityJournalView';
import { IntegrationsView } from './IntegrationsView';
import { ExtensionSyncPanel } from '../mcp/ExtensionSyncPanel';
import { senderApi } from '../../services/senderApi';
import { SenderSession } from '../../types/sender';

export type BusinessCenterTab = 
  | 'CONVERSATIONS' 
  | 'CRM' 
  | 'CAMPAIGNS' 
  | 'TEMPLATES' 
  | 'PRODUCTS' 
  | 'LINKS' 
  | 'AI_AGENT' 
  | 'ANALYTICS' 
  | 'LOGS' 
  | 'INTEGRATIONS';

export const DigiWareBusinessCenterView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<BusinessCenterTab>('CONVERSATIONS');
  const [session, setSession] = useState<SenderSession | null>(null);
  const [isSyncPanelOpen, setIsSyncPanelOpen] = useState(false);
  const [selectedTargetListId, setSelectedTargetListId] = useState<string | undefined>(undefined);

  useEffect(() => {
    senderApi.getStatus().then(res => setSession(res.session)).catch(() => {});
    const interval = setInterval(() => {
      senderApi.getStatus().then(res => setSession(res.session)).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const navItems: { id: BusinessCenterTab; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'CONVERSATIONS', label: '1. Conversations', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'CRM', label: '2. CRM', icon: <Users className="w-4 h-4" /> },
    { id: 'CAMPAIGNS', label: '3. Campagnes', icon: <Layers className="w-4 h-4" /> },
    { id: 'TEMPLATES', label: '4. Templates', icon: <FileText className="w-4 h-4" /> },
    { id: 'PRODUCTS', label: '5. Produits & Catalogue', icon: <ShoppingBag className="w-4 h-4" /> },
    { id: 'LINKS', label: '6. Link Center', icon: <Link2 className="w-4 h-4" /> },
    { id: 'AI_AGENT', label: '7. AI Agent', icon: <Bot className="w-4 h-4" /> },
    { id: 'ANALYTICS', label: '8. Analytics', icon: <BarChart2 className="w-4 h-4" /> },
    { id: 'LOGS', label: '9. Journal & Activité', icon: <History className="w-4 h-4" /> },
    { id: 'INTEGRATIONS', label: '10. Intégrations & Paramètres', icon: <Settings className="w-4 h-4" /> }
  ];

  return (
    <div className="space-y-4">
      {/* Top Banner / Identity of DigiWare WhatsApp Business Center */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-100">
                DigiWare WhatsApp Business Center
              </h1>
              <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold">
                Centre Métier WordPress
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Messagerie WhatsApp Web réelle, CRM dynamique, Campagnes multi-segments, Catalogue WooCommerce & Link Center.
            </p>
          </div>
        </div>

        {/* Live Session Status Badge & Direct MCP Sync */}
        <div className="flex items-center gap-2.5 self-start md:self-auto flex-wrap">
          <button
            onClick={() => setIsSyncPanelOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 hover:text-emerald-200 text-xs font-bold transition-all shadow-sm cursor-pointer"
            title="Mettre à jour l'extension WordPress sur le site via MCP"
          >
            <Zap className="w-3.5 h-3.5 text-emerald-400 fill-current" />
            <span>Mettre à jour l'extension (MCP)</span>
          </button>

          <button
            onClick={() => setActiveTab('INTEGRATIONS')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
              session?.status === 'CONNECTED'
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/60'
                : 'bg-amber-950/70 text-amber-300 border-amber-500/40 hover:bg-amber-900/60'
            }`}
            title="Gérer la session WhatsApp Web réelle"
          >
            <span className={`w-2.5 h-2.5 rounded-full ${
              session?.status === 'CONNECTED'
                ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                : 'bg-amber-400 animate-ping'
            }`} />
            <span>
              {session?.status === 'CONNECTED'
                ? `WhatsApp Web : ${session.phoneNumber || 'Connecté'}`
                : 'WhatsApp Web Déconnecté • Configurer'}
            </span>
          </button>
        </div>
      </div>

      {/* Primary 10 Spaces Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 bg-slate-900/60 p-1.5 rounded-2xl border border-slate-800/80 text-xs no-scrollbar">
        {navItems.map(item => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Render the Active Space */}
      <div className="transition-all">
        {activeTab === 'CONVERSATIONS' && (
          <ConversationsView 
            onNavigateToTemplates={() => setActiveTab('TEMPLATES')}
            onNavigateToCrm={() => setActiveTab('CRM')}
          />
        )}
        {activeTab === 'CRM' && (
          <CrmView 
            onOpenConversation={() => setActiveTab('CONVERSATIONS')}
            onNavigateToCampaigns={(targetListId) => {
              setSelectedTargetListId(targetListId);
              setActiveTab('CAMPAIGNS');
            }}
          />
        )}
        {activeTab === 'CAMPAIGNS' && (
          <CampaignsView 
            initialTargetListId={selectedTargetListId}
            onNavigateToCrm={(_listId) => {
              setActiveTab('CRM');
            }}
          />
        )}
        {activeTab === 'TEMPLATES' && <TemplatesView />}
        {activeTab === 'PRODUCTS' && <ProductsView />}
        {activeTab === 'LINKS' && <LinkCenterView />}
        {activeTab === 'AI_AGENT' && <AiAgentView />}
        {activeTab === 'ANALYTICS' && <AnalyticsView />}
        {activeTab === 'LOGS' && <ActivityJournalView />}
        {activeTab === 'INTEGRATIONS' && <IntegrationsView />}
      </div>

      {/* EXTENSION SYNC & MCP UPDATE PANEL */}
      <ExtensionSyncPanel
        isOpen={isSyncPanelOpen}
        onClose={() => setIsSyncPanelOpen(false)}
      />
    </div>
  );
};
