import React, { useState, useEffect } from 'react';
import { 
  History, Clock, CheckCircle, AlertTriangle, Send, Link, 
  Bot, User, ArrowRight, ShieldCheck 
} from 'lucide-react';
import { BusinessActivityLog } from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

export const ActivityJournalView: React.FC = () => {
  const [logs, setLogs] = useState<BusinessActivityLog[]>([]);

  useEffect(() => {
    businessCenterApi.getActivityLogs().then(setLogs).catch(console.error);
  }, []);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-400" />
          Journal d'Activité & Traçabilité Métier Intégrale
        </h2>
        <p className="text-xs text-slate-400">
          Traçabilité de bout en bout : Contact ID → Conversation → Campagne → Segment → Template → Link ID → Job ID → Message ID → OmniTracker.
        </p>
      </div>

      {/* Distinction fondamentale */}
      <div className="p-3 bg-slate-900/50 border border-slate-800/80 rounded-xl text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2">
        <span className="text-slate-300 font-semibold">Distinction des états réels :</span>
        <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">Job créé ≠ Message envoyé</span>
        <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">Envoyé ≠ Délivré</span>
        <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">Lien généré ≠ Clic effectif</span>
        <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">Clic ≠ Commande WooCommerce</span>
      </div>

      {/* Logs Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="divide-y divide-slate-800/60 text-xs">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              Aucun événement dans le journal.
            </div>
          ) : (
            logs.map(log => (
              <div key={log.id} className="p-3.5 hover:bg-slate-800/40 transition-colors flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      log.event_type === 'MESSAGE_SENT' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' :
                      log.event_type === 'MESSAGE_RECEIVED' ? 'bg-indigo-950 text-indigo-300 border border-indigo-500/30' :
                      log.event_type === 'JOB_DISPATCHED' ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/30' :
                      log.event_type === 'LINK_CLICKED' ? 'bg-amber-950 text-amber-300 border border-amber-500/30' :
                      log.event_type === 'SENDER_ALERT' ? 'bg-rose-950 text-rose-300 border border-rose-500/30' :
                      'bg-slate-800 text-slate-400'
                    }`}>
                      {log.event_type}
                    </span>
                    <strong className="text-slate-200">{log.title}</strong>
                  </div>

                  {/* IDs de traçabilité */}
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono flex-wrap pt-0.5">
                    {log.contact_id && <span>contact: {log.contact_id}</span>}
                    {log.conversation_id && <span>conv: {log.conversation_id}</span>}
                    {log.campaign_id && <span>camp: {log.campaign_id}</span>}
                    {log.segment_id && <span>seg: {log.segment_id}</span>}
                    {log.link_id && <span>link: {log.link_id}</span>}
                    {log.job_id && <span>job: {log.job_id}</span>}
                    {log.message_id && <span>msg: {log.message_id}</span>}
                  </div>
                </div>

                <div className="text-[10px] text-slate-500 shrink-0 font-mono">
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
