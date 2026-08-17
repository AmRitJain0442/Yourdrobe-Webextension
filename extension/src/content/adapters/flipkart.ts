import type { CommerceAdapter } from "./types";
import { classifyProductType } from "../../product-type";
import { absoluteUrl, image, price, text, valid, visible } from "./shared";

const clothing = /shirt|dress|top|trouser|jean|jacket|kurta|saree|t-?shirt/i;

export function flipkartAdapter(hostname: string, document: Document): CommerceAdapter {
  return {
    extractProducts: () => valid([...document.querySelectorAll("[data-id]")].filter(visible).map((card) => {
      const title = text(card, [".product-title", "[class*='KzDlHZ']"])
        || card.querySelector("img")?.getAttribute("alt")?.trim() || "";
      const href = card.querySelector("a[href*='/p/']")?.getAttribute("href") || "";
      const category = clothing.test(title) ? "apparel" : "other";
      return {
        platform: "flipkart",
        title,
        price: price(text(card, [".price", "[class*='Nx9bqj']"])),
        currency: "INR",
        category,
        product_type: classifyProductType(title, category),
        image_url: image(card),
        product_url: href ? absoluteUrl(hostname, href) : "",
        metadata: {},
      };
    })),
  };
}
