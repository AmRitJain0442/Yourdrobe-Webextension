import type { CommerceAdapter } from "./types";
import { absoluteUrl, image, price, text, valid, visible } from "./shared";

const clothing = /shirt|dress|top|trouser|jean|jacket|kurta|saree|t-?shirt/i;

export function flipkartAdapter(hostname: string, document: Document): CommerceAdapter {
  return {
    extractProducts: () => valid([...document.querySelectorAll("[data-id]")].filter(visible).map((card) => {
      const title = text(card, [".product-title", "[class*='KzDlHZ']"])
        || card.querySelector("img")?.getAttribute("alt")?.trim() || "";
      const href = card.querySelector("a[href*='/p/']")?.getAttribute("href") || "";
      return {
        platform: "flipkart",
        title,
        price: price(text(card, [".price", "[class*='Nx9bqj']"])),
        currency: "INR",
        category: clothing.test(title) ? "apparel" : "other",
        image_url: image(card),
        product_url: href ? absoluteUrl(hostname, href) : "",
        metadata: {},
      };
    })),
  };
}
