import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export const ReadingProgress: React.FC = () => {
  const docContent = useAppStore((state) => state.document.content);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [wordCount, setWordCount] = useState(0);

  useEffect(() => {
    if (!docContent) {
      setWordCount(0);
      return;
    }

    const timer = setTimeout(() => {
      // Contagem de alta performance sem alocação massiva de arrays no heap
      let count = 0;
      let inWord = false;
      let inTag = false;
      const len = docContent.length;

      for (let i = 0; i < len; i++) {
        const ch = docContent.charCodeAt(i);
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

      setWordCount(count);
    }, 400);

    return () => clearTimeout(timer);
  }, [docContent]);

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
    
    // Run once initially
    handleScroll();
    
    // Also observe changes in content height to recalculate
    const resizeObserver = new ResizeObserver(() => handleScroll());
    resizeObserver.observe(document.body);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

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
