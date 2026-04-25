import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import ja from './ja.js';
import en from './en.js';
import type { Translations } from './ja.js';

export type Lang = 'ja' | 'en';

const RESOURCES: Record<Lang, Translations> = { ja, en };
const STORAGE_KEY = 'kohya-lang';

function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
  if (stored && stored in RESOURCES) return stored;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  return browser === 'ja' ? 'ja' : 'en';
}

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const LangContext = createContext<LangContextValue>({
  lang: 'ja',
  setLang: () => {},
  t: ja,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = (l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  };

  // Sync html[lang] attribute
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t: RESOURCES[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

/** Use inside any component to get translations and lang switcher. */
export function useT() {
  return useContext(LangContext);
}
