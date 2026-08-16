import { addOutfitToCarts } from "./cart";
import type { OutfitItem } from "../profile/types";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FINALIZE_OUTFIT" || !Array.isArray(message.items)) return false;
  void addOutfitToCarts(message.items as OutfitItem[]).then(sendResponse, () => sendResponse({ added: 0, needs_attention: [], carts_opened: 0, error: "We could not open the retailer carts." }));
  return true;
});
