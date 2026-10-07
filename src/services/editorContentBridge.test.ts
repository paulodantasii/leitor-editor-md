import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerEditorFlushHandler,
  markBridgeDirty,
  markBridgeClean,
  hasPendingBridgeChanges,
  flushPendingEditorContent,
} from './editorContentBridge';

describe('editorContentBridge', () => {
  beforeEach(() => {
    markBridgeClean();
  });

  it('não deve lançar erro se flushPendingEditorContent for chamado sem nenhum handler registrado', () => {
    expect(() => flushPendingEditorContent()).not.toThrow();
  });

  it('não deve invocar o handler de flush se não houver alterações pendentes (hasPendingChanges = false)', () => {
    const handler = vi.fn();
    const unregister = registerEditorFlushHandler(handler);

    flushPendingEditorContent();

    expect(handler).not.toHaveBeenCalled();
    unregister();
  });

  it('deve invocar o handler quando houver alterações pendentes e for chamado flushPendingEditorContent', () => {
    const handler = vi.fn(() => {
      markBridgeClean();
    });
    const unregister = registerEditorFlushHandler(handler);

    markBridgeDirty();
    expect(hasPendingBridgeChanges()).toBe(true);

    flushPendingEditorContent();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(hasPendingBridgeChanges()).toBe(false);

    unregister();
  });

  it('deve permitir desregistrar o handler através da função de limpeza retornada', () => {
    const handler = vi.fn();
    const unregister = registerEditorFlushHandler(handler);

    unregister();
    markBridgeDirty();
    flushPendingEditorContent();

    expect(handler).not.toHaveBeenCalled();
  });

  it('deve capturar e não quebrar a aplicação caso o handler de flush lance uma exceção', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const faultyHandler = vi.fn(() => {
      throw new Error('Falha simulada na serialização do ProseMirror');
    });

    const unregister = registerEditorFlushHandler(faultyHandler);
    markBridgeDirty();

    expect(() => flushPendingEditorContent()).not.toThrow();
    expect(faultyHandler).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    unregister();
  });
});
