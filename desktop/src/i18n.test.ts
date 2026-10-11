import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTranslator,
  detectSystemLocale,
  getSystemLocale,
  LANGUAGE_STORAGE_KEY,
  parseLanguagePreference,
  readLanguagePreference,
  resolveLocale,
  translateBackendMessage,
  writeLanguagePreference,
} from "./i18n";
import { messages } from "./locales";
import type { LanguagePreference, Locale } from "./i18n";

afterEach(() => vi.unstubAllGlobals());

describe("language preferences", () => {
  it.each([
    [["zh-CN"], "zh"],
    [["zh-TW"], "zh"],
    [["ZH_hans_CN"], "zh"],
    [["ja-JP"], "ja"],
    [["en-GB"], "en"],
    [["fr-FR", "ja-JP", "en-US"], "ja"],
    [["en-US", "zh-CN"], "en"],
    [["de-DE"], "en"],
    [[], "en"],
  ] as [string[], Locale][])("resolves %j to %s", (languages, expected) => {
    expect(detectSystemLocale(languages)).toBe(expected);
  });

  it("uses the webview language list and falls back to its primary language", () => {
    vi.stubGlobal("navigator", { languages: ["ja-JP"], language: "en-US" });
    expect(getSystemLocale()).toBe("ja");
    vi.stubGlobal("navigator", { languages: [], language: "zh-CN" });
    expect(getSystemLocale()).toBe("zh");
  });

  it("follows system changes only when the preference is system", () => {
    expect(resolveLocale("system", "ja")).toBe("ja");
    expect(resolveLocale("system", "zh")).toBe("zh");
    expect(resolveLocale("en", "ja")).toBe("en");
    expect(resolveLocale("zh", "ja")).toBe("zh");
  });

  it.each(["system", null, undefined, "", "fr", "zh-CN", "{}"])(
    "defaults an absent or unsupported stored value %j to system",
    (value) => expect(parseLanguagePreference(value)).toBe("system"),
  );

  it("persists and restores every supported preference", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(readLanguagePreference()).toBe("system");
    for (const preference of [
      "en",
      "zh",
      "ja",
      "system",
    ] as LanguagePreference[]) {
      expect(writeLanguagePreference(preference)).toBe(true);
      expect(values.get(LANGUAGE_STORAGE_KEY)).toBe(preference);
      expect(readLanguagePreference()).toBe(preference);
    }
  });

  it("keeps localization available when preference storage is inaccessible", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Storage unavailable");
      },
      setItem: () => {
        throw new Error("Storage unavailable");
      },
    });
    expect(readLanguagePreference()).toBe("system");
    expect(writeLanguagePreference("ja")).toBe(false);
    expect(createTranslator(resolveLocale("system", "ja"))("Settings")).toBe(
      "設定",
    );
  });
});

describe("translations", () => {
  it("has a nonempty translation with matching placeholders in both languages for every message", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [source, translations] of Object.entries(messages)) {
      for (const translation of translations) {
        expect(translation.trim(), source).not.toBe("");
        expect(placeholders(translation), source).toEqual(placeholders(source));
      }
    }
  });

  it("preserves literal user values instead of interpreting replacement syntax", () => {
    const name = "$& $1 {count} 日本語";
    expect(createTranslator("zh")("Delete {name}", { name })).toBe(
      "删除 $& $1 {count} 日本語",
    );
    expect(createTranslator("ja")("{count} skills", { count: 0 })).toBe(
      "0 個のスキル",
    );
    expect(createTranslator("en")("Focus: {name}", { name })).toBe(
      `Focus: ${name}`,
    );
  });

  it("renders previously received statuses and notices in the newly selected language", () => {
    const notice = "Target project is synced";
    expect(translateBackendMessage(createTranslator("zh"), notice)).toBe(
      "目标项目已同步",
    );
    expect(translateBackendMessage(createTranslator("ja"), notice)).toBe(
      "対象プロジェクトは同期済みです",
    );
    expect(translateBackendMessage(createTranslator("en"), notice)).toBe(
      notice,
    );
  });

  it("translates application messages while preserving external diagnostic details", () => {
    const diagnostic = "fatal: permission denied\n/path/日本語/$&";
    expect(
      translateBackendMessage(
        createTranslator("ja"),
        `Committed locally; push failed: ${diagnostic}`,
      ),
    ).toBe(
      `ローカルにコミット済みですが、プッシュに失敗しました：${diagnostic}`,
    );
    for (const unknown of [
      diagnostic,
      "An unknown future backend error",
      "__proto__",
      "",
    ]) {
      expect(translateBackendMessage(createTranslator("zh"), unknown)).toBe(
        unknown,
      );
    }
  });

  it("preserves names, paths, and recovery details in parameterized backend errors", () => {
    const t = createTranslator("zh");
    expect(
      translateBackendMessage(
        t,
        "Preset has been deleted or does not exist: my-id. Choose another preset",
      ),
    ).toBe("预设已删除或不存在：my-id。请选择其他预设");
    expect(
      translateBackendMessage(
        t,
        "src/$&/日本語.ts changed after preview. Preview again",
      ),
    ).toBe("预览后 src/$&/日本語.ts 发生了变化，请重新预览");
    expect(
      translateBackendMessage(t, "Custom $1 references a missing skill"),
    ).toBe("Custom $1 引用了不存在的技能");
    expect(
      translateBackendMessage(
        t,
        'Update failed: git error\n/path; recovery also failed, target project needs repair: permission denied; state record: Err("disk full")',
      ),
    ).toBe(
      '更新失败：git error\n/path；恢复也失败了，目标项目需要修复：permission denied；状态记录：Err("disk full")',
    );
  });
});
