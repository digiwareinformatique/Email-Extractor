import React, { useState, useEffect } from 'react';
import { 
  Link2, Plus, ExternalLink, Copy, Check, BarChart2, ShieldCheck, 
  Tag, Eye, Filter, ArrowUpRight 
} from 'lucide-react';
import { LinkCenterLink } from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

export const LinkCenterView: React.FC = () => {
  const [links, setLinks] = useState<LinkCenterLink[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New Link Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    destination_url: '',
    utm_source: 'whatsapp',
    utm_medium: 'direct_msg',
    utm_campaign: 'prospection_q3',
    utm_content: '',
    utm_term: ''
  });

  useEffect(() => {
    loadLinks();
  }, []);

  const loadLinks = async () => {
    try {
      const list = await businessCenterApi.getLinks();
      setLinks(list);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.destination_url.trim() || !formData.title.trim()) return;

    try {
      await businessCenterApi.saveLink({
        title: formData.title.trim(),
        destination_url: formData.destination_url.trim(),
        utm_source: formData.utm_source,
        utm_medium: formData.utm_medium,
        utm_campaign: formData.utm_campaign,
        utm_content: formData.utm_content || undefined,
        utm_term: formData.utm_term || undefined
      });
      setIsModalOpen(false);
      setFormData({
        title: '',
        destination_url: '',
        utm_source: 'whatsapp',
        utm_medium: 'direct_msg',
        utm_campaign: 'prospection_q3',
        utm_content: '',
        utm_term: ''
      });
      loadLinks();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-cyan-400" />
            Link Center — Orchestration des Liens, UTM & OmniTracker
          </h2>
          <p className="text-xs text-slate-400">
            Génération de liens courts (Shortener), contextes link_id stables et résolution d'attribution des clics avec OmniTracker.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md self-start md:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Générer un Lien Court Tracké</span>
        </button>
      </div>

      {/* Info Banner Architecture */}
      <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-center text-indigo-400 font-bold shrink-0">
            1
          </div>
          <div>
            <strong className="text-slate-200 block text-[11px]">Shortener Dédié (dgw.tn)</strong>
            <p className="text-slate-400 text-[10px]">Liens ultra-courts adaptés à la lecture mobile WhatsApp sans URL à rallonge.</p>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold shrink-0">
            2
          </div>
          <div>
            <strong className="text-slate-200 block text-[11px]">OmniTracker Gateway</strong>
            <p className="text-slate-400 text-[10px]">Chaque lien possède un <code>link_id</code> immuable pour attribuer visites, leads et paniers.</p>
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold shrink-0">
            3
          </div>
          <div>
            <strong className="text-slate-200 block text-[11px]">Règles GTM & UTM</strong>
            <p className="text-slate-400 text-[10px]">Normalisation automatique des paramètres <code>utm_source</code>, <code>medium</code> et <code>campaign</code>.</p>
          </div>
        </div>
      </div>

      {/* Table des liens */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Titre du Lien</th>
                <th className="py-3 px-4">Lien Court & Identifiant</th>
                <th className="py-3 px-4">URL de Destination</th>
                <th className="py-3 px-4">Paramètres UTM</th>
                <th className="py-3 px-4">Contexte OmniTracker</th>
                <th className="py-3 px-4 text-center">Clics Réels</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {links.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Aucun lien tracké enregistré.
                  </td>
                </tr>
              ) : (
                links.map(l => (
                  <tr key={l.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-100">
                      {l.title}
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-cyan-400 font-semibold">{l.short_url}</span>
                        <button
                          onClick={() => handleCopy(l.short_url, l.id)}
                          className="text-slate-500 hover:text-slate-200"
                          title="Copier le lien court"
                        >
                          {copiedId === l.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">link_id: {l.link_id}</span>
                    </td>

                    <td className="py-3 px-4 max-w-xs truncate text-slate-400">
                      <a
                        href={l.destination_url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-slate-200 inline-flex items-center gap-1 truncate"
                      >
                        <span className="truncate">{l.destination_url}</span>
                        <ArrowUpRight className="w-3 h-3 shrink-0" />
                      </a>
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-[10px] space-y-0.5 font-mono">
                        <div><span className="text-slate-500">src:</span> {l.utm_source}</div>
                        <div><span className="text-slate-500">med:</span> {l.utm_medium}</div>
                        <div><span className="text-slate-500">camp:</span> {l.utm_campaign}</div>
                      </div>
                    </td>

                    <td className="py-3 px-4 font-mono text-[10px] text-indigo-400">
                      {l.omnitracker_context_id}
                    </td>

                    <td className="py-3 px-4 text-center font-mono font-bold text-emerald-400 text-sm">
                      {l.clicks_count}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleCopy(l.short_url, l.id)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold"
                      >
                        {copiedId === l.id ? 'Copié !' : 'Copier'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Créer Lien */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-100 mb-3 pb-2 border-b border-slate-800">
              Générer un Lien Court OmniTracker
            </h3>

            <form onSubmit={handleCreateLink} className="space-y-3 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Titre de référence *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Offre Lancement Logiciel Legal Pro"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">URL de Destination *</label>
                <input
                  type="url"
                  required
                  placeholder="https://digiware.tn/boutique/legal-pro"
                  value={formData.destination_url}
                  onChange={(e) => setFormData({ ...formData, destination_url: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">utm_source</label>
                  <input
                    type="text"
                    value={formData.utm_source}
                    onChange={(e) => setFormData({ ...formData, utm_source: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">utm_medium</label>
                  <input
                    type="text"
                    value={formData.utm_medium}
                    onChange={(e) => setFormData({ ...formData, utm_medium: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1">utm_campaign</label>
                <input
                  type="text"
                  value={formData.utm_campaign}
                  onChange={(e) => setFormData({ ...formData, utm_campaign: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg"
                >
                  Générer le Lien Court
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
