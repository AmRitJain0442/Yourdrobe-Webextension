import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve("src/sidepanel/styles.css"), "utf8");

describe("side panel button contrast", () => {
  it("uses the supplied extension design tokens and image-first catalog grid", () => {
    expect(css).toContain("--color-primary: #f43f7a");
    expect(css).toContain("--gradient-ai: linear-gradient(135deg, #f43f7a 0%, #ff5d9a 55%, #7c5cfa 100%)");
    expect(css).toMatch(/font-family:\s*Poppins,/);
    expect(css).toMatch(/\.product-page\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,/);
    expect(css).toMatch(/\.catalog-card img\s*{[^}]*aspect-ratio:\s*4\s*\/\s*5;/);
  });

  it("keeps the supplied light theme regardless of system appearance", () => {
    expect(css).toMatch(/\.secondary:hover\s*{[^}]*background:[^;]+;[^}]*color:[^;]+;/);
    expect(css).not.toContain("prefers-color-scheme: dark");
  });

  it("preserves the danger hover foreground and background pairing", () => {
    expect(css).toMatch(/\.danger:hover\s*{[^}]*background: var\(--danger-hover\);[^}]*color: var\(--danger-text\);/);
  });

  it("keeps active-outfit controls visibly busy and the preview contained", () => {
    expect(css).toMatch(/button:disabled\s*{[^}]*cursor:[^;]+;[^}]*opacity:[^;]+;/);
    expect(css).toMatch(/\.active-outfit\s*{[^}]*margin-bottom:[^;]+;/);
    expect(css).toMatch(/\.active-outfit img\s*{[^}]*max-height:[^;]+;[^}]*object-fit:\s*contain;/);
  });

  it("keeps the active outfit large and preview choices horizontally scrollable", () => {
    expect(css).toMatch(/\.active-outfit img\s*{[^}]*height:\s*min\(60vh,\s*560px\);[^}]*object-fit:\s*contain;/);
    expect(css).toMatch(/\.preview-strip\s*{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*scroll-snap-type:\s*x mandatory;/);
    expect(css).toMatch(/\.preview-strip > \*\s*{[^}]*flex:\s*0 0 min\(86%,\s*320px\);[^}]*scroll-snap-align:\s*start;/);
  });
});
