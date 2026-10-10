import React, { useState, useEffect } from 'react';
import { 
  Settings, CheckCircle2, AlertCircle, RefreshCw, Smartphone, 
  Layers, ShoppingCart, Link2, Key, ShieldCheck, QrCode, ExternalLink 
} from 'lucide-react';
import { businessCenterApi } from '../../services/businessCenterApi';
import { senderApi } from '../../services/senderApi';
import { SenderSession } from '../../types/sender';

interface IntegrationsViewProps {
  onOpenSessionModal?: () => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = () => {
  const [integrations, setIntegrations] = useState<any>(null);
  const [session, setSession] = useState<SenderSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [quickPairPhone, setQuickPairPhone] = useState('+216');
  const [pairingStatusMsg, setPairingStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setIsLoading(true);
    try {
      const [intStatus, sessionStatus] = await Promise.all([
        businessCenterApi.getIntegrationsStatus(),
        senderApi.getStatus()
      ]);
      setIntegrations(intStatus);
      setSession(sessionStatus.session);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickConnect = async () => {
    if (!quickPairPhone || quickPairPhone.length < 8) return;
    try {
      setPairingStatusMsg('Connexion de la session en cours...');
      const sessionResult = await senderApi.confirmSession(quickPairPhone, 'DigiWare Pro Client');
      if (sessionResult) {
        setSession(sessionResult);
        setPairingStatusMsg(`✓ Session WhatsApp connectée avec succès pour ${sessionResult.phoneNumber}`);
        loadStatus();
      }
    } catch (err: any) {
      setPairingStatusMsg(`Erreur : ${err.message}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-400" />
            Intégrations Centrales & Architecture Métier
          </h2>
          <p className="text-xs text-slate-400">
            Raccordement direct aux services existants : WhatsApp Sender (Session Web réelle), OmniTracker, Shortener, WooCommerce et MCP Bridge.
          </p>
        </div>

        <button
          onClick={loadStatus}
          disabled={isLoading}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Rafraîchir les statuts</span>
        </button>
      </div>

      {/* Suppression définitive de Turbo Pro */}
      <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs flex items-center justify-between">
        <span className="text-slate-300">
          <strong>Architecture Épurée :</strong> Le workflow manuel « Export Turbo Pro » a été définitivement supprimé.
        </span>
        <span className="text-emerald-400 font-semibold text-[11px] flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Transmission directe via WhatsApp Sender Engine API
        </span>
      </div>

      {/* Cartes d'intégrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* WhatsApp Sender Engine */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-slate-100 block">WhatsApp Sender (Baileys Web V1)</strong>
                <span className="text-[10px] text-slate-400">Application d'exécution WhatsApp Web réelle</span>
              </div>
            </div>

            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              session?.status === 'CONNECTED'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                : 'bg-amber-950 text-amber-300 border border-amber-500/30'
            }`}>
              {session?.status === 'CONNECTED' ? 'CONNECTÉ' : 'NON CONNECTÉ'}
            </span>
          </div>

          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1 text-[11px] text-slate-300 font-mono">
            <div>Numéro actif : <span className="text-emerald-400 font-bold">{session?.phoneNumber || 'Aucun'}</span></div>
            <div>Plateforme : <span className="text-slate-400">{session?.platform || 'WhatsApp Web'}</span></div>
            <div>Dernière activité : <span className="text-slate-400">{session?.lastActiveAt || 'N/A'}</span></div>
          </div>

          {session?.status !== 'CONNECTED' && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="text-[11px] text-slate-400 block">Activer immédiatement la session WhatsApp :</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="+216 98 123 456"
                  value={quickPairPhone}
                  onChange={(e) => setQuickPairPhone(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-100 font-mono text-xs"
                />
                <button
                  onClick={handleQuickConnect}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Valider
                </button>
              </div>
              {pairingStatusMsg && (
                <span className="text-[10px] text-emerald-400 block">{pairingStatusMsg}</span>
              )}
            </div>
          )}
        </div>

        {/* OmniTracker Gateway */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-slate-100 block">OmniTracker Infrastructure</strong>
                <span className="text-[10px] text-slate-400">Tracking, contexte link_id, identité et attribution</span>
              </div>
            </div>

            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/30">
              ACTIF
            </span>
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed">
            Avant chaque envoi, le plugin prépare le contexte du lien et enregistre l'empreinte auprès d'OmniTracker. Après le clic, la gateway résout le <code>link_id</code> et consigne l'événement sans solliciter le Sender.
          </p>
        </div>

        {/* Shortener Dédié (dgw.tn) */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                <Link2 className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-slate-100 block">Shortener Plugin (dgw.tn)</strong>
                <span className="text-[10px] text-slate-400">Création et redirection technique des URLs courtes</span>
              </div>
            </div>

            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/30">
              CONNECTÉ
            </span>
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed">
            Format compact préservant l'esthétique des messages WhatsApp. Redirection HTTP 301/302 avec transfert transparent des balises UTM vers la boutique WooCommerce.
          </p>
        </div>

        {/* WooCommerce */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <ShoppingCart className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-slate-100 block">Boutique & Catalogue WooCommerce</strong>
                <span className="text-[10px] text-slate-400">Produits, commandes réelles et historique d'achat</span>
              </div>
            </div>

            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/30">
              SYNCHRONISÉ
            </span>
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed">
            Lecture directe des fiches produits, des disponibilités réelles et des commandes passées. Ne modifie pas les prix automatiquement.
          </p>
        </div>
      </div>
    </div>
  );
};
