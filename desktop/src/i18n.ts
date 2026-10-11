import { messages } from "./locales";

export type Locale = "en" | "zh" | "ja";
export type LanguagePreference = Locale | "system";
export type Message = keyof typeof messages;
export type Translator = (
  message: Message,
  values?: Record<string, string | number>,
) => string;

export const LANGUAGE_STORAGE_KEY = "aicfg.language";
export const documentLanguages: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
  ja: "ja",
};

export function parseLanguagePreference(value: unknown): LanguagePreference {
  return value === "en" || value === "zh" || value === "ja" ? value : "system";
}

export function readLanguagePreference(): LanguagePreference {
  try {
    return parseLanguagePreference(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeLanguagePreference(
  preference: LanguagePreference,
): boolean {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function detectSystemLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === "en" || base === "zh" || base === "ja") return base;
  }
  return "en";
}

export function getSystemLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return detectSystemLocale(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}

export function resolveLocale(
  preference: LanguagePreference,
  systemLocale: Locale,
): Locale {
  return preference === "system" ? systemLocale : preference;
}

export function createTranslator(locale: Locale): Translator {
  return (message, values = {}) => {
    const template =
      locale === "en" ? message : messages[message][locale === "zh" ? 0 : 1];
    // A callback preserves literal dollar signs and braces in user-provided values.
    return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
      values[key] === undefined ? placeholder : String(values[key]),
    );
  };
}

const diagnosticMessages = (Object.keys(messages) as Message[])
  .filter((message) => message.endsWith("{error}"))
  .map((message) => ({ message, prefix: message.slice(0, -"{error}".length) }));

const backendTemplates: readonly Message[] = [
  "Preset reference cycle: {names}",
  "Preset has been deleted or does not exist: {id}. Choose another preset",
  "{name} references a missing skill",
  "{name} references a missing rule",
  "The selected version for {name} is not required by its presets",
  "Configuration file must not be a symbolic link: {path}",
  "Source content for {name} does not match the adopted fingerprint",
  "The installer did not create the expected directory for {name}",
  "Choose how to resolve the conflict for {path} first",
  "{path} changed after preview. Preview again",
  "{path} is an existing directory. Move it before enabling the corresponding adapter",
  "Invalid relative path: {path}",
  "Could not save configuration: {error}; recovery failed, inspect the configuration repository: {details}",
  "Update failed: {error}; recovery also failed, target project needs repair: {details}; state record: {state}",
];
const parameterizedMessages = backendTemplates.map((message) => {
  const names = [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  const pattern = message
    .split(/(\{\w+\})/g)
    .map((part) =>
      /^\{\w+\}$/.test(part)
        ? "(.*?)"
        : part.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"),
    )
    .join("");
  return { message, names, pattern: new RegExp("^" + pattern + "$", "s") };
});

// The Rust protocol keeps its English messages. Translate at render time so
// existing statuses and notices also update when the language changes.
// Unrecognized messages and external Git/OS diagnostics remain readable.
export function translateBackendMessage(
  t: Translator,
  message: string,
): string {
  if (Object.prototype.hasOwnProperty.call(messages, message))
    return t(message as Message);
  for (const { message: template, prefix } of diagnosticMessages) {
    if (message.startsWith(prefix)) {
      return t(template, { error: message.slice(prefix.length) });
    }
  }
  for (const { message: template, names, pattern } of parameterizedMessages) {
    const match = pattern.exec(message);
    if (match) {
      return t(
        template,
        Object.fromEntries(
          names.map((name, index) => [name, match[index + 1]]),
        ),
      );
    }
  }
  return message;
}
