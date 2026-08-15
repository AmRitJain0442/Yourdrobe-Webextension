import type { CommerceAdapter } from "./types";
import { classifyProductType } from "../../product-type";
import { absoluteUrl, image, price, text, valid, visible } from "./shared";

export function amazonAdapter(hostname: string, document: Document): CommerceAdapter {
  const india = hostname.endsWith("amazon.in");
  return {
    extractProducts: () => valid(
      [...document.querySelectorAll("[data-component-type='s-search-result']")].filter(visible).map((card) => {
        const asin = card.getAttribute("data-asin")?.trim() || "";
        const heading = card.querySelector("h2[aria-label]");
        const href = /^[a-z0-9]{10}$/i.test(asin)
          ? `/dp/${asin}`
          : heading?.closest("a")?.getAttribute("href")
            || card.querySelector("h2 a")?.getAttribute("href")
            || "";
        const whole = text(card, [".a-price-whole"]);
        const fraction = text(card, [".a-price-fraction"]);
        const title = text(card, ["h2[aria-label] span", "h2[aria-label]", "h2 a span", "h2 a", "h2 span", "h2"]);
        return {
          platform: india ? "amazon_in" : "amazon_us",
          title,
          price: price(fraction ? `${whole}.${fraction}` : whole),
          currency: india ? "INR" : "USD",
          category: "apparel",
          product_type: classifyProductType(title, "apparel"),
          image_url: image(card),
          product_url: href ? absoluteUrl(hostname, href) : "",
          metadata: {},
        };
      }),
    ),
  };
}
