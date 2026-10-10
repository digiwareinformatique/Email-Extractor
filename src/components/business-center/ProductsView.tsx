import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, Star, Check, Tag, ExternalLink, HelpCircle, 
  Sparkles, Plus, Edit2, ShieldCheck, ChevronRight 
} from 'lucide-react';
import { WcProduct } from '../../types/businessCenter';
import { businessCenterApi } from '../../services/businessCenterApi';

export const ProductsView: React.FC = () => {
  const [products, setProducts] = useState<WcProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<WcProduct | null>(null);
  const [newArgument, setNewArgument] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const list = await businessCenterApi.getProducts();
      setProducts(list);
      if (list.length > 0 && !selectedProduct) {
        setSelectedProduct(list[0]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTogglePromoted = async (p: WcProduct) => {
    try {
      await businessCenterApi.updateProductCommercial(p.id, { is_promoted: !p.is_promoted });
      loadProducts();
      if (selectedProduct?.id === p.id) {
        setSelectedProduct({ ...selectedProduct, is_promoted: !p.is_promoted });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddArgument = async () => {
    if (!selectedProduct || !newArgument.trim()) return;
    const updatedArgs = [...selectedProduct.commercial_arguments, newArgument.trim()];
    try {
      await businessCenterApi.updateProductCommercial(selectedProduct.id, { commercial_arguments: updatedArgs });
      setSelectedProduct({ ...selectedProduct, commercial_arguments: updatedArgs });
      setNewArgument('');
      loadProducts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddFaq = async () => {
    if (!selectedProduct || !newQuestion.trim() || !newAnswer.trim()) return;
    const updatedFaq = [...selectedProduct.faq, { question: newQuestion.trim(), answer: newAnswer.trim() }];
    try {
      await businessCenterApi.updateProductCommercial(selectedProduct.id, { faq: updatedFaq });
      setSelectedProduct({ ...selectedProduct, faq: updatedFaq });
      setNewQuestion('');
      setNewAnswer('');
      loadProducts();
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
            <ShoppingBag className="w-5 h-5 text-indigo-400" />
            Catalogue WooCommerce & Couche Commerciale DigiWare
          </h2>
          <p className="text-xs text-slate-400">
            Associez des arguments de vente documentés, FAQ et priorités commerciales aux produits WooCommerce pour alimenter l'AI Agent et les campagnes.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-3 py-1.5 rounded-xl font-semibold self-start md:self-auto">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Synchronisation WooCommerce Active</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Liste des produits à gauche */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1 mb-2">
            Produits du Catalogue ({products.length})
          </h3>

          <div className="space-y-2">
            {products.map(p => {
              const isSelected = selectedProduct?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProduct(p)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border-indigo-500 shadow-md'
                      : 'bg-slate-900/60 border-slate-800 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">
                        {p.title}
                      </h4>
                      <span className="text-[10px] text-slate-500 font-mono">
                        SKU: {p.sku}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-bold text-emerald-400 font-mono">
                        {p.sale_price ? `${p.sale_price} TND` : `${p.price} TND`}
                      </span>
                      {p.sale_price && (
                        <span className="text-[10px] text-slate-500 line-through block font-mono">
                          {p.regular_price} TND
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-800/80">
                    <span className="text-slate-400">
                      {p.categories.join(', ')}
                    </span>

                    {p.is_promoted && (
                      <span className="bg-amber-950 text-amber-300 border border-amber-500/40 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Star className="w-3 h-3 fill-current" />
                        Mis en avant
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Détail & enrichissement commercial du produit sélectionné */}
        {selectedProduct && (
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
            {/* Header produit */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  {selectedProduct.title}
                  <a
                    href={selectedProduct.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-500 hover:text-slate-300"
                    title="Voir fiche sur WooCommerce"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-xl">
                  {selectedProduct.description}
                </p>
              </div>

              <button
                onClick={() => handleTogglePromoted(selectedProduct)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  selectedProduct.is_promoted
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
                }`}
              >
                <Star className="w-3.5 h-3.5 fill-current" />
                <span>{selectedProduct.is_promoted ? 'Produit Promu (Prioritaire)' : 'Mettre en avant'}</span>
              </button>
            </div>

            {/* Arguments commerciaux documentés */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Arguments Commerciaux Documentés (Exploités par l'AI Agent & Templates)
              </h4>

              <div className="space-y-1.5">
                {selectedProduct.commercial_arguments.map((arg, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg text-xs text-slate-200 flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{arg}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  placeholder="Ajouter un argument commercial documenté..."
                  value={newArgument}
                  onChange={(e) => setNewArgument(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddArgument()}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                />
                <button
                  onClick={handleAddArgument}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold"
                >
                  Ajouter
                </button>
              </div>
            </div>

            {/* FAQ Produit */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
                Questions Fréquentes (FAQ Utilisée pour les Réponses IA)
              </h4>

              <div className="space-y-2">
                {selectedProduct.faq.map((item, idx) => (
                  <div key={idx} className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-1 text-xs">
                    <strong className="text-slate-200 block">Q: {item.question}</strong>
                    <p className="text-slate-400">R: {item.answer}</p>
                  </div>
                ))}
              </div>

              <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2 text-xs">
                <span className="font-semibold text-slate-300 text-[11px] block">Ajouter une question / réponse :</span>
                <input
                  type="text"
                  placeholder="Question client fréquente..."
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100"
                />
                <textarea
                  rows={2}
                  placeholder="Réponse officielle documentée..."
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 resize-none"
                />
                <button
                  onClick={handleAddFaq}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold"
                >
                  Enregistrer dans la base de connaissance
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
