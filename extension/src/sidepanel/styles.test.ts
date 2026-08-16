import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/sidepanel/styles.css"), "utf8");

describe("side panel button contrast", () => {
  it("defines contrasting secondary hover colors in light and dark schemes", () => {
    expect(css).toMatch(/\.secondary:hover\s*{[^}]*background:[^;]+;[^}]*color:[^;]+;/);
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(dark).toMatch(/\.secondary:hover\s*{[^}]*background:[^;]+;[^}]*color:[^;]+;/);
  });

  it("preserves the danger hover foreground and background pairing", () => {
    expect(css).toMatch(/\.danger:hover\s*{[^}]*background: var\(--danger-hover\);[^}]*color: var\(--danger-text\);/);
  });

  it("keeps active-outfit controls visibly busy and the preview contained", () => {
    expect(css).toMatch(/button:disabled\s*{[^}]*cursor:[^;]+;[^}]*opacity:[^;]+;/);
    expect(css).toMatch(/\.active-outfit\s*{[^}]*margin-bottom:[^;]+;/);
    expect(css).toMatch(/\.active-outfit img\s*{[^}]*max-height:[^;]+;[^}]*object-fit:\s*contain;/);
  });
});
