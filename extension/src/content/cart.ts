import type { AddToCartResponse } from "../types";

const enabled = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && !(element as HTMLButtonElement).disabled;

export function addCurrentProductToCart(hostname: string, document: Document): AddToCartResponse {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  let control: Element | null | undefined;
  if (host === "amazon.in" || host === "amazon.com") {
    control = document.querySelector("#add-to-cart-button, input[name='submit.add-to-cart']");
  } else {
    const label = host === "flipkart.com" ? /^add to cart$/i : host === "nykaa.com" ? /^add to (bag|cart)$/i : null;
    control = label ? [...document.querySelectorAll("button")].find((button) => label.test(button.textContent?.trim() ?? "")) : null;
  }
  const button = control ?? null;
  if (!enabled(button)) return { ok: false, error: "Choose any required size or option, then add this product to the cart." };
  button.click();
  return { ok: true };
}
