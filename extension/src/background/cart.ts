import type { OutfitItem } from "../profile/types";
import type { AddToCartResponse } from "../types";

const stores: Record<OutfitItem["platform"], { host: string; cart: string }> = {
  amazon_in: { host: "amazon.in", cart: "https://www.amazon.in/gp/cart/view.html" },
  amazon_us: { host: "amazon.com", cart: "https://www.amazon.com/gp/cart/view.html" },
  flipkart: { host: "flipkart.com", cart: "https://www.flipkart.com/rv/viewcart" },
  nykaa: { host: "nykaa.com", cart: "https://www.nykaa.com/cart" },
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForLoad(tab?: chrome.tabs.Tab): Promise<void> {
  if (!tab) return Promise.reject(new Error("The shopping tab could not be opened."));
  if (tab.status === "complete") return Promise.resolve();
  if (!tab.id) return Promise.reject(new Error("The product tab could not be opened."));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("The product page took too long to load.")), 20_000);
    const updated = (tabId: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (tabId === tab.id && info.status === "complete") finish();
    };
    const removed = (tabId: number) => {
      if (tabId === tab.id) finish(new Error("The product tab was closed."));
    };
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      error ? reject(error) : resolve();
    };
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
  });
}

function validItem(input: unknown): input is OutfitItem {
  if (!input || typeof input !== "object") return false;
  const item = input as Record<string, unknown>;
  if (typeof item.platform !== "string" || !(item.platform in stores)
    || typeof item.title !== "string" || !item.title.trim()
    || typeof item.product_url !== "string") return false;
  const store = stores[item.platform as OutfitItem["platform"]];
  try {
    const url = new URL(item.product_url);
    return store && url.protocol === "https:" && url.hostname.toLowerCase().replace(/^www\./, "") === store.host;
  } catch {
    return false;
  }
}

async function sendCartMessage(tabId: number): Promise<AddToCartResponse> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage<unknown, AddToCartResponse>(tabId, { type: "ADD_TO_CART" });
    } catch (error) {
      if (attempt === 2) throw error;
      await delay(200);
    }
  }
  throw new Error("The product page could not be reached.");
}

export async function addOutfitToCarts(input: unknown[]) {
  const valid = input.filter(validItem);
  const items = valid.filter((item, index) => valid.findIndex((candidate) => candidate.product_url === item.product_url) === index).slice(0, 20);
  if (!items.length) return { added: 0, needs_attention: [], carts_opened: 0 };
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error("No active shopping tab is available.");
  const needs_attention: string[] = [];
  let added = 0;
  for (const item of items) {
    try {
      const tab = await chrome.tabs.update(activeTab.id, { active: true, url: item.product_url });
      await waitForLoad(tab);
      const response = await sendCartMessage(activeTab.id);
      if (!response.ok) {
        needs_attention.push(item.title);
        return { added, needs_attention, carts_opened: 0 };
      }
      await delay(1_200);
      added += 1;
    } catch {
      needs_attention.push(item.title);
      return { added, needs_attention, carts_opened: 0 };
    }
  }
  const cartTab = await chrome.tabs.update(activeTab.id, { active: true, url: stores[items.at(-1)!.platform].cart });
  await waitForLoad(cartTab);
  return { added, needs_attention, carts_opened: 1 };
}
