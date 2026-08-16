import type { OutfitItem } from "../profile/types";
import type { AddToCartResponse } from "../types";

const stores: Record<OutfitItem["platform"], { host: string; cart: string }> = {
  amazon_in: { host: "amazon.in", cart: "https://www.amazon.in/gp/cart/view.html" },
  amazon_us: { host: "amazon.com", cart: "https://www.amazon.com/gp/cart/view.html" },
  flipkart: { host: "flipkart.com", cart: "https://www.flipkart.com/rv/viewcart" },
  nykaa: { host: "nykaa.com", cart: "https://www.nykaa.com/cart" },
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForLoad(tab: chrome.tabs.Tab): Promise<void> {
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
  const needs_attention: string[] = [];
  const addedStores = new Set<OutfitItem["platform"]>();
  let added = 0;
  for (const item of items) {
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.create({ active: false, url: item.product_url });
      await waitForLoad(tab);
      if (!tab.id) throw new Error("The product tab could not be opened.");
      const response = await sendCartMessage(tab.id);
      if (!response.ok) {
        await chrome.tabs.update(tab.id, { active: true });
        needs_attention.push(item.title);
        continue;
      }
      await delay(1_200);
      await chrome.tabs.remove(tab.id);
      added += 1;
      addedStores.add(item.platform);
    } catch {
      needs_attention.push(item.title);
      if (tab?.id) await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
    }
  }
  for (const platform of addedStores) await chrome.tabs.create({ active: true, url: stores[platform].cart });
  return { added, needs_attention, carts_opened: addedStores.size };
}
