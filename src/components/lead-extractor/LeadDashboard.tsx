import React from 'react';
import { 
  Users, Mail, Globe, Sparkles, CheckCircle2, 
  HelpCircle, ShieldAlert, TrendingUp, Phone, Building2 
} from 'lucide-react';
import { DashboardMetrics } from '../../types/lead';

interface LeadDashboardProps {
  metrics: DashboardMetrics | null;
  isLoading: boolean;
}

export const LeadDashboard: React.FC<LeadDashboardProps> = ({ metrics, isLoading }) => {
  if (isLoading || !metrics) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white p-4 rounded-xl border border-slate-200/80 h-24"></div>
        ))}
      </div>
    );
  }

  const enrichmentRate = metrics.totalLeads > 0 
    ? Math.round(((metrics.withEmail + metrics.withWebsite) / (metrics.totalLeads * 2)) * 100)
    : 0;

  return (
    <div className="space-y-4 mb-6">
      {/* 6 Top Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Total Leads */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Leads</span>
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <Users className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-slate-900 font-mono">
            {metrics.totalLeads.toLocaleString('fr-FR')}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Numéros tunisiens importés</p>
        </div>

        {/* Card 2: Avec Email */}
        <div className="bg-white p-3.5 rounded-xl border border-emerald-200/70 shadow-2xs bg-emerald-50/20">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Avec Email</span>
            <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
              <Mail className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-emerald-950 font-mono">
            {metrics.withEmail.toLocaleString('fr-FR')}
          </div>
          <p className="text-[11px] text-emerald-600/80 mt-0.5 font-medium">
            {metrics.totalLeads > 0 ? `${Math.round((metrics.withEmail / metrics.totalLeads) * 100)}% de couverture` : '0%'}
          </p>
        </div>

        {/* Card 3: Sans Email */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sans Email</span>
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Phone className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-slate-800 font-mono">
            {metrics.withoutEmail.toLocaleString('fr-FR')}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Téléphone direct seul</p>
        </div>

        {/* Card 4: Avec Site Web */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">Avec Site</span>
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <Globe className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-slate-900 font-mono">
            {metrics.withWebsite.toLocaleString('fr-FR')}
          </div>
          <p className="text-[11px] text-blue-600/80 mt-0.5">Portails officiels trouvés</p>
        </div>

        {/* Card 5: Confiance HIGH */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-700">Confiance Élevée</span>
            <div className="p-1.5 bg-purple-50 text-purple-600 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-slate-900 font-mono">
            {metrics.highConfidence.toLocaleString('fr-FR')}
          </div>
          <p className="text-[11px] text-purple-600/80 mt-0.5">Données 100% vérifiées</p>
        </div>

        {/* Card 6: Ambigu / Non Trouvé */}
        <div className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Non Trouvés</span>
            <div className="p-1.5 bg-slate-100 text-slate-500 rounded-lg">
              <HelpCircle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold text-slate-700 font-mono">
            {metrics.notFound.toLocaleString('fr-FR')}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">Aucun profil public</p>
        </div>
      </div>
    </div>
  );
};
