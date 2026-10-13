// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

function render(text: string) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<Markdown text={text} />);
  return container;
}

describe("Markdown document metadata", () => {
  it.each([
    ["LF", "", "\n", "---"],
    ["CRLF with BOM", "\uFEFF", "\r\n", "---"],
    ["YAML end marker", "", "\n", "..."],
  ])(
    "separates %s frontmatter from the document body",
    (_, prefix, newline, end) => {
      const metadata = [
        'name: "Code review"',
        "description: >",
        "  Review code and explain findings.",
        "metadata:",
        "  tags: [review, quality]",
        '  example: "<script>alert(1)</script>"',
      ].join(newline);
      const container = render(
        `${prefix}---${newline}${metadata}${newline}${end}${newline}# Instructions${newline}${newline}Read the **diff**.`,
      );
      const details = container.querySelector("details");
      expect(details?.open).toBe(false);
      expect(details?.querySelector("summary")?.textContent).toBe("Metadata");
      expect(details?.querySelector("code")?.textContent).toBe(
        metadata.replace(/\r\n/g, "\n"),
      );
      expect(container.querySelectorAll("h1, h2")).toHaveLength(1);
      expect(container.querySelector("h1")?.textContent).toBe("Instructions");
      expect(container.querySelector("strong")?.textContent).toBe("diff");
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("hr")).toBeNull();
    },
  );

  it("keeps ordinary Markdown and GFM tables intact", () => {
    const container = render(
      "# README\n\n---\n\n| Name | Value |\n| --- | --- |\n| Skill | Review |\n\n---",
    );
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("README");
    expect(container.querySelectorAll("hr")).toHaveLength(2);
    expect(container.querySelector("table")?.textContent).toContain("Review");
  });

  it("preserves an unclosed frontmatter block", () => {
    const container = render("---\nname: incomplete\n\n# Instructions");
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).toContain("name: incomplete");
    expect(container.querySelector("h1")?.textContent).toBe("Instructions");
  });

  it("supports documents containing only metadata", () => {
    const container = render("---\nname: review\n---");
    expect(container.querySelector("code")?.textContent).toBe("name: review");
    expect(container.querySelector("h2")).toBeNull();
  });
});
