import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "./I18nProvider";

export function Markdown({ text }: { text: string }) {
  const { t } = useI18n();
  // Only a complete frontmatter block at the start is document metadata.
  const frontmatter =
    /^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/.exec(
      text,
    );
  const body = frontmatter ? text.slice(frontmatter[0].length) : text;

  return (
    <div className="markdown">
      {frontmatter && (
        <details className="markdown-metadata">
          <summary>{t("Metadata")}</summary>
          <pre>
            <code>{frontmatter[1]}</code>
          </pre>
        </details>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {body}
      </ReactMarkdown>
    </div>
  );
}
