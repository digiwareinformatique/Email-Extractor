import React, { useState, useEffect } from 'react';
import { 
  BarChart2, TrendingUp, Users, CheckCircle, Clock, AlertTriangle, 
  Send, Eye, ShoppingCart, MessageSquare, ArrowUpRight 
} from 'lucide-react';
import { BusinessCenterAnalytics } from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

export const AnalyticsView: React.FC = () => {
  const [analytics, setAnalytics] = useState<BusinessCenterAnalytics | null>(null);

  useEffect(() => {
    businessCenterApi.getAnalytics().then(setAnalytics).catch(console.error);
  }, []);

  if (!analytics) return null;

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-emerald-400" />
          Analytics & Performance Commerciale WhatsApp
        </h2>
        <p className="text-xs text-slate-400">
          Suivi en direct de l'entonnoir d'engagement : Jobs préparés → Envois confirmés → Réponses reçues → Clics OmniTracker → Commandes WooCommerce.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span>Envois Confirmés</span>
            <Send className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400">
            {analytics.messages_sent}
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Messages délivrés sur WhatsApp</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span>Réponses Reçues</span>
            <MessageSquare className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-xl font-bold font-mono text-indigo-400">
            {analytics.replies_received}
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Taux d'engagement actif</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span>Clics Liens (Shortener)</span>
            <Eye className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl font-bold font-mono text-cyan-400">
            {analytics.links_clicked}
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Résolution OmniTracker validée</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span>Conversions Attribuées</span>
            <ShoppingCart className="w-4 h-4 text-emerald-300" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-300">
            {analytics.attributed_conversions}
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Commandes WooCommerce reliées</span>
        </div>
      </div>

      {/* Funnel d'attribution */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          Tunnel de Conversion OmniTracker & WhatsApp
        </h3>

        <div className="space-y-3 text-xs">
          {[
            { label: '1. Jobs Préparés & Quotas Alloués', value: analytics.jobs_prepared, total: analytics.jobs_prepared, color: 'bg-slate-700' },
            { label: '2. Messages Transmis & Délivrés au Sender', value: analytics.messages_delivered, total: analytics.jobs_prepared, color: 'bg-emerald-600' },
            { label: '3. Réponses & Conversations Ouvertes', value: analytics.replies_received, total: analytics.jobs_prepared, color: 'bg-indigo-600' },
            { label: '4. Clics sur Liens Produits dgw.tn', value: analytics.links_clicked, total: analytics.jobs_prepared, color: 'bg-cyan-600' },
            { label: '5. Ventes & Devis Finalisés', value: analytics.attributed_conversions, total: analytics.jobs_prepared, color: 'bg-emerald-400' }
          ].map((stage, idx) => {
            const pct = Math.min(Math.round((stage.value / (stage.total || 1)) * 100), 100);
            return (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-slate-200">{stage.label}</span>
                  <span className="font-mono text-slate-400">{stage.value} ({pct}%)</span>
                </div>
                <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div className={`h-full ${stage.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
