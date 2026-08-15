import type { CommerceAdapter } from "./types";
import { absoluteUrl, image, price, text, valid, visible } from "./shared";

export function nykaaAdapter(hostname: string, document: Document): CommerceAdapter {
  return {
    extractProducts: () => valid([
      ...document.querySelectorAll("[data-testid='product-card'], .productWrapper"),
    ].filter(visible).map((card) => {
      const href = card.querySelector("a[href*='/p/']")?.getAttribute("href") || "";
      const shade = text(card, [".shade"]);
      return {
        platform: "nykaa",
        title: text(card, [".product-title", "[class*='css-xrzmfa']"])
          || card.querySelector("img")?.getAttribute("alt")?.trim() || "",
        price: price(text(card, [".price", "[class*='css-111z9ua']"])),
        currency: "INR",
        category: "makeup",
        image_url: image(card),
        product_url: href ? absoluteUrl(hostname, href) : "",
        metadata: shade ? { shade } : {},
      };
    })),
  };
}
