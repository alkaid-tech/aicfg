import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  createTranslator,
  documentLanguages,
  getSystemLocale,
  LANGUAGE_STORAGE_KEY,
  parseLanguagePreference,
  readLanguagePreference,
  resolveLocale,
  writeLanguagePreference,
} from "./i18n";
import type { LanguagePreference, Locale, Translator } from "./i18n";

interface I18nContextValue {
  locale: Locale;
  preference: LanguagePreference;
  setPreference: (value: string) => void;
  persistenceError: boolean;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  preference: "system",
  setPreference: () => {},
  persistenceError: false,
  t: createTranslator("en"),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readLanguagePreference);
  const [systemLocale, setSystemLocale] = useState(getSystemLocale);
  const [persistenceError, setPersistenceError] = useState(false);
  const locale = resolveLocale(preference, systemLocale);
  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = documentLanguages[locale];
  }, [locale]);

  useEffect(() => {
    const updateSystemLocale = () => setSystemLocale(getSystemLocale());
    const updatePreference = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
        setPreference(readLanguagePreference());
        setPersistenceError(false);
      }
    };
    window.addEventListener("languagechange", updateSystemLocale);
    // Some webviews only report an OS language change after regaining focus.
    window.addEventListener("focus", updateSystemLocale);
    window.addEventListener("storage", updatePreference);
    return () => {
      window.removeEventListener("languagechange", updateSystemLocale);
      window.removeEventListener("focus", updateSystemLocale);
      window.removeEventListener("storage", updatePreference);
    };
  }, []);

  return (
    <I18nContext.Provider
      value={{
        locale,
        preference,
        persistenceError,
        t,
        setPreference: (value) => {
          const next = parseLanguagePreference(value);
          setPersistenceError(!writeLanguagePreference(next));
          setPreference(next);
        },
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
