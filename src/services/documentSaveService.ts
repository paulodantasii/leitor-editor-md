import { saveCoordinator } from './saveCoordinator';
import { SaveResult } from '../types';

export type ManualSaveStatus = 'saved' | 'cancelled' | 'error';

export interface ManualSaveResult {
  status: ManualSaveStatus;
  message?: string;
  sourceRevision?: number;
}

/**
 * Ponto de entrada de salvamento manual (botão Salvar, Ctrl+S, "Salvar e continuar").
 * Delega para o saveCoordinator, garantindo fila serializada, coalescência e rastreamento
 * de revisões monotônicas.
 */
export async function saveActiveDocument(): Promise<ManualSaveResult> {
  const result: SaveResult = await saveCoordinator.save({ interactive: true });

  if (result.status === 'ok') {
    return {
      status: 'saved',
      message: result.message,
      sourceRevision: result.sourceRevision,
    };
  }

  if (result.status === 'cancelled') {
    return { status: 'cancelled' };
  }

  return {
    status: 'error',
    message: result.message,
  };
}
