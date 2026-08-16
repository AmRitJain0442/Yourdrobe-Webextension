import { selectAdapter } from "./adapters";
import type { ExtractProductsResponse } from "../types";
import { addCurrentProductToCart } from "./cart";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ADD_TO_CART") {
    sendResponse(addCurrentProductToCart(location.hostname, document));
    return false;
  }
  if (message?.type !== "EXTRACT_PRODUCTS") return false;
  const adapter = selectAdapter(location.hostname, document);
  const response: ExtractProductsResponse = adapter
    ? { ok: true, products: adapter.extractProducts() }
    : { ok: false, error: "This shopping site is not supported." };
  sendResponse(response);
  return false;
});
