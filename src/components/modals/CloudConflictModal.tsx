import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { downloadMarkdownFile } from '../../services/exportService';
import { flushPendingEditorContent } from '../../services/editorContentBridge';
import { saveRecentDocument } from '../../services/recentDocumentsService';
import { AlertTriangle, Cloud, HardDrive, Download, X } from 'lucide-react';
import { MiddleEllipsisText } from '@/components/ui/MiddleEllipsisText';

export const CloudConflictModal: React.FC = () => {
  const {
    cloudConflict,
    setCloudConflict,
    document: currentDoc,
    setDocument,
    setSyncStatus,
    setSyncNotification,
  } = useAppStore(
    useShallow((state) => ({
      cloudConflict: state.cloudConflict,
      setCloudConflict: state.setCloudConflict,
      document: state.document,
      setDocument: state.setDocument,
      setSyncStatus: state.setSyncStatus,
      setSyncNotification: state.setSyncNotification,
    }))
  );

  if (!cloudConflict) return null;

  const isOneDrive = Boolean(currentDoc?.oneDriveItemId);
  const formattedCloudTime = cloudConflict.cloudModified
    ? new Date(cloudConflict.cloudModified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'recente';

  const handleAcceptCloud = async () => {
    flushPendingEditorContent();
    const freshBeforeOverwrite = useAppStore.getState().document;
    if (freshBeforeOverwrite && freshBeforeOverwrite.content.trim().length > 0) {
      await saveRecentDocument({ ...freshBeforeOverwrite }, 'conflict').catch(() => {});
    }

    const nextRev = (freshBeforeOverwrite?.revision ?? currentDoc?.revision ?? 0) + 1;
    const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDocument({
      content: cloudConflict.cloudContent,
      revision: nextRev,
      sourceRevision: nextRev,
      draftRevision: Math.max(freshBeforeOverwrite?.draftRevision ?? 0, nextRev),
      ...(isOneDrive
        ? { cloudLastModified: cloudConflict.cloudModified, cloudETag: null }
        : { localLastModified: new Date(cloudConflict.cloudModified).getTime() || Date.now() }),
      lastSavedAt: nowFormatted,
      isDirty: false,
    });
    const afterUpdate = useAppStore.getState().document;
    if (afterUpdate) {
      await saveRecentDocument({ ...afterUpdate }, 'sync').catch(() => {});
    }
    setSyncStatus('saved');
    setCloudConflict(null);
    setSyncNotification(
      isOneDrive
        ? `Versão da nuvem (${formattedCloudTime}) carregada com sucesso`
        : `Versão externa do arquivo (${formattedCloudTime}) carregada com sucesso`
    );
  };

  const handleKeepLocal = () => {
    // Keep local changes and clear/update external marker so next sync overwrites
    setDocument({
      ...(isOneDrive
        ? { cloudLastModified: cloudConflict.cloudModified, cloudETag: null }
        : { localLastModified: new Date(cloudConflict.cloudModified).getTime() || Date.now() }),
      isDirty: true,
    });
    setCloudConflict(null);
    setSyncNotification(
      isOneDrive
        ? 'Mantidas as alterações deste dispositivo. Clique em Sincronizar para enviar para a nuvem.'
        : 'Mantidas as alterações deste navegador. Clique em Sincronizar para gravar no arquivo local.'
    );
  };

  const handleBackupAndAcceptCloud = async () => {
    // Download current unsaved local changes to device
    flushPendingEditorContent();
    const freshDoc = useAppStore.getState().document;
    if (freshDoc) {
      downloadMarkdownFile(freshDoc.content, `backup_local_${freshDoc.title}`);
    }
    await handleAcceptCloud();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Conflito de Versões Detectado
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <MiddleEllipsisText
                  text={currentDoc?.title || 'Documento'}
                  className="max-w-[260px]"
                />
              </p>
            </div>
          </div>

          <button
            onClick={handleKeepLocal}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message */}
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {isOneDrive ? (
            <>
              Uma versão mais recente deste documento foi salva no OneDrive em outro dispositivo às{' '}
              <strong className="text-slate-800 dark:text-slate-100 font-semibold">{formattedCloudTime}</strong>, mas você também possui alterações pendentes neste dispositivo.
            </>
          ) : (
            <>
              O arquivo local foi modificado fora do aplicativo às{' '}
              <strong className="text-slate-800 dark:text-slate-100 font-semibold">{formattedCloudTime}</strong>, mas você também possui alterações pendentes neste navegador.
            </>
          )}
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <button
            type="button"
            onClick={handleAcceptCloud}
            className="w-full h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
          >
            <Cloud className="w-4 h-4" />
            {isOneDrive ? 'Carregar Versão da Nuvem (Recomendado)' : 'Carregar Versão do Arquivo Local (Recomendado)'}
          </button>

          <button
            type="button"
            onClick={handleBackupAndAcceptCloud}
            className="w-full h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-purple-500" />
            {isOneDrive ? 'Salvar Cópia Local e Carregar Nuvem' : 'Baixar Cópia do Editor e Carregar Disco'}
          </button>

          <button
            type="button"
            onClick={handleKeepLocal}
            className="w-full h-10 px-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <HardDrive className="w-4 h-4" />
            Manter Minhas Alterações Locais
          </button>
        </div>
      </div>
    </div>
  );
};
