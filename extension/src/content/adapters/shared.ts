import type { Product } from "../../types";

export function text(root: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return "";
}

export function image(root: Element): string {
  const element = root.querySelector("img");
  return element?.getAttribute("src") || element?.getAttribute("data-src") || "";
}

export function absoluteUrl(hostname: string, href: string): string {
  try {
    const url = new URL(href, `https://${hostname}`);
    const normalized = (value: string) => value.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && normalized(url.hostname) === normalized(hostname) ? url.href : "";
  } catch {
    return "";
  }
}

export function price(value: string): number | undefined {
  const number = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function visible(root: Element): boolean {
  for (let element: Element | null = root; element; element = element.parentElement) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true"
      || style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

export function valid(products: Product[]): Product[] {
  return products.filter((item) => item.title && item.image_url && item.product_url).slice(0, 5);
}
