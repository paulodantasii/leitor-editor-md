import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import {
  X,
  Monitor,
  Tablet,
  Download,
  Share2,
  PlusSquare,
  CheckCircle2,
  ExternalLink,
  Laptop,
} from 'lucide-react';

export const InstallAppModal: React.FC = () => {
  const { isInstallModalOpen, setIsInstallModalOpen } = useAppStore(
    useShallow((state) => ({
      isInstallModalOpen: state.isInstallModalOpen,
      setIsInstallModalOpen: state.setIsInstallModalOpen,
    }))
  );

  const { isInstallable, isStandalone, platform, triggerInstall } = usePwaInstall();
  const [activeTab, setActiveTab] = useState<'windows' | 'ipad'>(() =>
    platform === 'ios' ? 'ipad' : 'windows'
  );
  const [installSuccess, setInstallSuccess] = useState(false);

  if (!isInstallModalOpen) return null;

  const handleInstallClick = async () => {
    const result = await triggerInstall();
    if (result === 'accepted') {
      setInstallSuccess(true);
      setTimeout(() => {
        setInstallSuccess(false);
        setIsInstallModalOpen(false);
      }, 1500);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={() => setIsInstallModalOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg p-5 sm:p-6 space-y-4 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 pb-3.5">
          <div className="flex items-center gap-3">
            <img
              src="./apple-touch-icon.png"
              alt="Ícone do Leitor & Editor MD"
              className="w-10 h-10 rounded-xl shadow-xs border border-slate-200 dark:border-slate-600 object-cover"
            />
            <div>
              <h3
                id="install-modal-title"
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                Instalar Aplicativo
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Use como um programa no Windows ou atalho no iPad
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsInstallModalOpen(false)}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas Windows / iPad */}
        <div className="flex p-1 bg-slate-100 dark:bg-slate-900/70 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('windows')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'windows'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Laptop className="w-4 h-4" />
            <span>Windows (Chrome / Edge)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ipad')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'ipad'
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Tablet className="w-4 h-4" />
            <span>iPad (Safari)</span>
          </button>
        </div>

        {/* Conteúdo Aba Windows */}
        {activeTab === 'windows' && (
          <div className="space-y-4 pt-1">
            {isStandalone ? (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs font-medium text-emerald-900 dark:text-emerald-200">
                  O aplicativo já está instalado e em execução no modo nativo de janela!
                </span>
              </div>
            ) : isInstallable ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                  Instale diretamente no Windows para criar um atalho na <strong>Área de Trabalho</strong>, no <strong>Menu Iniciar</strong> e abrir em janela própria com desempenho nativo.
                </div>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {installSuccess ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Instalado com Sucesso!
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Instalar no Windows Agora
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 leading-relaxed space-y-2">
                <p className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Monitor className="w-4 h-4 text-blue-500" />
                  Como instalar pelo Chrome ou Microsoft Edge:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-slate-400">
                  <li>
                    Olhe no <strong>canto direito da barra de endereços</strong> do navegador (onde fica o link).
                  </li>
                  <li>
                    No <strong>Chrome</strong>: clique no ícone de <strong>computador com seta para baixo</strong> ("Instalar Leitor & Editor Markdown").
                  </li>
                  <li>
                    No <strong>Edge</strong>: clique no ícone de <strong>três pequenos quadrados com sinal de +</strong> ("Aplicativo disponível").
                  </li>
                  <li>
                    Ou acesse o menu de três pontos <strong>(⋮ / ...)</strong> ➔ <strong>"Aplicativos"</strong> ➔ <strong>"Instalar este site como um aplicativo"</strong>.
                  </li>
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Conteúdo Aba iPad */}
        {activeTab === 'ipad' && (
          <div className="space-y-3 pt-1">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Passo a passo no Safari do iPad:
              </p>

              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-2xs">
                <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 font-bold text-xs">
                  1
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  Na barra do Safari, toque no botão <strong>Compartilhar</strong> (ícone de um quadrado com a seta para cima <Share2 className="w-3.5 h-3.5 inline text-blue-500" />).
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-2xs">
                <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 font-bold text-xs">
                  2
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  Role a lista para baixo e toque em <strong>"Adicionar à Tela de Início"</strong> (<PlusSquare className="w-3.5 h-3.5 inline text-slate-500" />).
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-2xs">
                <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 font-bold text-xs">
                  3
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  O ícone oficial de alta resolução e o nome <strong>Leitor MD</strong> aparecerão automaticamente. Toque em <strong>Adicionar</strong>.
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 leading-normal">
              💡 Para salvar nos <strong>Favoritos</strong> do Safari, basta tocar em Compartilhar ➔ <strong>"Adicionar aos Favoritos"</strong>. O ícone oficial será exibido na sua grade de favoritos.
            </div>
          </div>
        )}

        {/* Rodapé */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex justify-end">
          <button
            type="button"
            onClick={() => setIsInstallModalOpen(false)}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
