import React from 'react';
import { OneDriveItem } from '../../types';
import { MiddleEllipsisText } from '@/components/ui/MiddleEllipsisText';
import {
  Folder,
  FileCode,
  Pencil,
  FolderInput,
  Copy,
  Trash2,
  Check,
  X,
} from 'lucide-react';

export interface OneDriveItemRowProps {
  item: OneDriveItem;
  isSelected: boolean;
  isSaveAs: boolean;
  isHighlightedSaveTarget: boolean;
  isOpenInEditor: boolean;
  isRenaming: boolean;
  renameValue: string;
  isConfirmingDelete: boolean;
  disabled: boolean;
  showParentPath?: boolean;
  onToggleSelect: (id: string) => void;
  onPrimaryClick: (item: OneDriveItem) => void;
  onStartRename: (item: OneDriveItem) => void;
  onRenameChange: (val: string) => void;
  onConfirmRename: (item: OneDriveItem) => void;
  onCancelRename: () => void;
  onStartDelete: (item: OneDriveItem) => void;
  onConfirmDelete: (item: OneDriveItem) => void;
  onCancelDelete: () => void;
  onStartMoveSingle: (item: OneDriveItem) => void;
  onDuplicateFile: (item: OneDriveItem) => void;
}

export const OneDriveItemRow: React.FC<OneDriveItemRowProps> = ({
  item,
  isSelected,
  isSaveAs,
  isHighlightedSaveTarget,
  isOpenInEditor,
  isRenaming,
  renameValue,
  isConfirmingDelete,
  disabled,
  showParentPath,
  onToggleSelect,
  onPrimaryClick,
  onStartRename,
  onRenameChange,
  onConfirmRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  onStartMoveSingle,
  onDuplicateFile,
}) => {
  const isFolder = Boolean(item.folder);

  // Formatação amigável de subcaminho em buscas globais
  const cleanParentPath = React.useMemo(() => {
    if (!showParentPath || !item.parentReference?.path) return null;
    const rawPath = item.parentReference.path;
    const marker = '/drive/root:';
    const idx = rawPath.indexOf(marker);
    if (idx !== -1) {
      const sub = rawPath.slice(idx + marker.length);
      return sub ? decodeURIComponent(sub) : '/';
    }
    return rawPath;
  }, [showParentPath, item.parentReference?.path]);

  // Modo de confirmação inline de exclusão
  if (isConfirmingDelete) {
    return (
      <div className="flex items-center justify-between py-1 px-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs">
        <span className="text-red-700 dark:text-red-300 font-medium truncate max-w-[280px] sm:max-w-[360px]">
          Excluir &quot;{item.name}&quot;?
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onConfirmDelete(item);
            }}
            className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer text-[11px]"
          >
            Sim, excluir
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onCancelDelete();
            }}
            className="px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer text-[11px]"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // Modo de renomeação inline
  if (isRenaming) {
    return (
      <div className="flex items-center gap-2 py-1 px-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-800 text-xs">
        {isFolder ? (
          <Folder className="w-4 h-4 text-amber-500 shrink-0" />
        ) : (
          <FileCode className="w-4 h-4 text-sky-500 shrink-0" />
        )}
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          type="text"
          value={renameValue}
          disabled={disabled}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              onConfirmRename(item);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancelRename();
            }
          }}
          className="flex-1 h-7 px-2 text-xs rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="button"
          disabled={disabled || !renameValue.trim()}
          onClick={(e) => {
            e.stopPropagation();
            onConfirmRename(item);
          }}
          title="Confirmar renomeação (Enter)"
          className="p-1 rounded text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 disabled:opacity-50 cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onCancelRename();
          }}
          title="Cancelar (Esc)"
          className="p-1 rounded text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Linha normal de alta densidade
  return (
    <div
      onClick={() => onPrimaryClick(item)}
      className={`group flex items-center justify-between py-1.5 px-2.5 rounded-lg transition-colors cursor-pointer select-none text-xs ${
        isHighlightedSaveTarget
          ? 'bg-sky-50 dark:bg-sky-950/50 border border-sky-300 dark:border-sky-800'
          : isSelected
          ? 'bg-sky-50/70 dark:bg-sky-950/30'
          : 'hover:bg-slate-100 dark:hover:bg-slate-700/60'
      }`}
    >
      {/* Lado Esquerdo: Checkbox + Ícone + Nome + Tags */}
      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
        <input
          type="checkbox"
          checked={isSelected}
          disabled={disabled}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect(item.id);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 rounded accent-sky-600 cursor-pointer shrink-0"
        />

        {isFolder ? (
          <Folder className="w-4 h-4 text-amber-500 shrink-0" />
        ) : (
          <FileCode className="w-4 h-4 text-sky-500 shrink-0" />
        )}

        <div className="min-w-0 flex items-center gap-1.5 flex-1">
          <span className="font-medium text-slate-800 dark:text-slate-200 group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate">
            <MiddleEllipsisText text={item.name} className="w-full" />
          </span>

          {isOpenInEditor && (
            <span className="shrink-0 px-1.5 py-0.2 text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 rounded">
              Aberto
            </span>
          )}

          {cleanParentPath && (
            <span
              title={`Local: ${cleanParentPath}`}
              className="hidden sm:inline-block shrink-0 text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[120px]"
            >
              {cleanParentPath}
            </span>
          )}
        </div>
      </div>

      {/* Lado Direito: Metadado + Ações Rápidas Inline */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[11px] text-slate-400 group-hover:text-slate-500 dark:group-hover:text-slate-400 font-mono mr-1">
          {isFolder
            ? `${item.folder?.childCount || 0} itens`
            : `${Math.max(1, Math.round((item.size || 0) / 1024))} KB`}
        </span>

        {/* Ações rápidas visíveis no hover (ou quando selecionado) */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onStartRename(item);
            }}
            title="Renomear"
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onStartMoveSingle(item);
            }}
            title="Mover para..."
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer"
          >
            <FolderInput className="w-3.5 h-3.5" />
          </button>

          {!isFolder && (
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onDuplicateFile(item);
              }}
              title="Criar cópia"
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onStartDelete(item);
            }}
            title="Excluir"
            className="p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* No modo Save As para arquivos: botão rápido Usar Nome */}
        {isSaveAs && !isFolder && (
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onPrimaryClick(item);
            }}
            className="ml-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/50 dark:hover:text-sky-300 cursor-pointer"
          >
            Usar nome
          </button>
        )}
      </div>
    </div>
  );
};
