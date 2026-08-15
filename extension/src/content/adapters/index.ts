import { amazonAdapter } from "./amazon";
import { flipkartAdapter } from "./flipkart";
import { nykaaAdapter } from "./nykaa";
import type { CommerceAdapter } from "./types";

export function selectAdapter(hostname: string, document: Document): CommerceAdapter | null {
  const host = hostname.replace(/^www\./, "");
  if (host === "amazon.in" || host === "amazon.com") return amazonAdapter(hostname, document);
  if (host === "flipkart.com") return flipkartAdapter(hostname, document);
  if (host === "nykaa.com") return nykaaAdapter(hostname, document);
  return null;
}
