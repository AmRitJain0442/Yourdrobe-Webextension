import type { CommerceAdapter } from "./types";
import { absoluteUrl, image, price, text, valid, visible } from "./shared";

export function amazonAdapter(hostname: string, document: Document): CommerceAdapter {
  const india = hostname.endsWith("amazon.in");
  return {
    extractProducts: () => valid(
      [...document.querySelectorAll("[data-component-type='s-search-result']")].filter(visible).map((card) => {
        const href = card.querySelector("h2 a")?.getAttribute("href") || "";
        const whole = text(card, [".a-price-whole"]);
        const fraction = text(card, [".a-price-fraction"]);
        return {
          platform: india ? "amazon_in" : "amazon_us",
          title: text(card, ["h2 span", "h2"]),
          price: price(fraction ? `${whole}.${fraction}` : whole),
          currency: india ? "INR" : "USD",
          category: "apparel",
          image_url: image(card),
          product_url: href ? absoluteUrl(hostname, href) : "",
          metadata: {},
        };
      }),
    ),
  };
}
