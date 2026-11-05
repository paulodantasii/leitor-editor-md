import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

function countWordsFast(text: string): number {
  let count = 0;
  let inWord = false;
  let inTag = false;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 60 /* < */) {
      inTag = true;
      inWord = false;
      continue;
    }
    if (ch === 62 /* > */) {
      inTag = false;
      continue;
    }
    if (inTag) continue;

    // Whitespace check: espaço (32), quebra de linha (10), CR (13), tab (9)
    if (ch <= 32) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count++;
    }
  }

  return count;
}

export const ReadingProgress: React.FC = () => {
  const docId = useAppStore((state) => state.document?.docId);
  const docContent = useAppStore((state) => state.document?.content);
  const isEditable = useAppStore((state) => state.isEditable);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const lastCountedDocIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!docContent) {
      setWordCount(0);
      lastCountedDocIdRef.current = docId;
      return;
    }

    const isNewDocument = lastCountedDocIdRef.current !== docId;
    lastCountedDocIdRef.current = docId;

    // Ao abrir um documento ou alternar de aba, calcula imediatamente para exibir o tempo exato
    if (isNewDocument) {
      setWordCount(countWordsFast(docContent));
      return;
    }

    // Em modo leitura (!isEditable), alterações de docContent são apenas grifos (<mark>),
    // que não alteram a quantidade de palavras do documento.
    if (!isEditable) {
      return;
    }

    const delay = docContent.length > 80000 ? 2500 : 800;
    let idleId: number | null = null;

    const timer = setTimeout(() => {
      const runCount = () => {
        setWordCount(countWordsFast(docContent));
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleId = (window as any).requestIdleCallback(runCount, { timeout: 2000 });
      } else {
        runCount();
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [docId, docContent, isEditable]);

  useEffect(() => {
    const handleScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        const progress = Math.min(100, Math.max(0, (window.scrollY / totalHeight) * 100));
        setScrollProgress(Math.round(progress));
      } else {
        setScrollProgress(100);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    // Recalcula imediatamente ao montar ou trocar de documento
    handleScroll();
    const rafId = requestAnimationFrame(handleScroll);

    // Observa mudanças reais de layout no corpo do documento e no container raiz
    const resizeObserver = new ResizeObserver(() => handleScroll());
    resizeObserver.observe(document.body);
    if (document.documentElement) {
      resizeObserver.observe(document.documentElement);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, [docId]);

  if (!docContent) return null;

  const totalMinutes = wordCount / 130;
  const remainingMinutes = Math.ceil(totalMinutes * ((100 - scrollProgress) / 100));
  const timeDisplay = remainingMinutes > 0 ? `${remainingMinutes} min` : 'Fim';

  return (
    <div className="fixed bottom-5 right-5 z-40 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md shadow-sm border border-slate-200 dark:border-slate-800 rounded-xl p-2 min-w-[3.5rem] flex flex-col items-center justify-center transition-all opacity-70 hover:opacity-100 pointer-events-none print:hidden">
      <span className="text-sm font-semibold text-slate-600 dark:text-slate-400 leading-tight">
        {scrollProgress}%
      </span>
      <span className="text-[9px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider mt-0.5">
        {timeDisplay}
      </span>
    </div>
  );
};
