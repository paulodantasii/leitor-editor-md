import React from 'react';
import { ArrowLeft, X } from 'lucide-react';

interface ModalNavButtonProps {
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export const ModalBackButton: React.FC<ModalNavButtonProps> = ({
  onClick,
  title = 'Voltar',
  ariaLabel,
  disabled = false,
  className = '',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel || title}
    className={`p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
  >
    <ArrowLeft className="w-5 h-5" />
  </button>
);

export const ModalCloseButton: React.FC<ModalNavButtonProps> = ({
  onClick,
  title = 'Fechar',
  ariaLabel,
  disabled = false,
  className = '',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel || title}
    className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/80 transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
  >
    <X className="w-5 h-5" />
  </button>
);
