import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutfitItem } from "../profile/types";
import { addOutfitToCarts } from "./cart";

const shirt: OutfitItem = {
  platform: "amazon_in", title: "Blue shirt", product_type: "top",
  product_url: "https://amazon.in/dp/TOP", image_url: "https://images.example/top.jpg",
};

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.chrome = { tabs: {
    query: vi.fn().mockResolvedValue([{ id: 10, status: "complete", active: true }]),
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    update: vi.fn().mockImplementation((id, properties) => Promise.resolve({ id, status: "complete", ...properties })),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  } } as unknown as typeof chrome;
});

describe("addOutfitToCarts", () => {
  it("adds products in the active tab and leaves that tab on the retailer cart", async () => {
    const pending = addOutfitToCarts([shirt]);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ added: 1, needs_attention: [], carts_opened: 1 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: "ADD_TO_CART" });
    expect(chrome.tabs.update).toHaveBeenNthCalledWith(1, 10, { active: true, url: shirt.product_url });
    expect(chrome.tabs.update).toHaveBeenNthCalledWith(2, 10, { active: true, url: "https://www.amazon.in/gp/cart/view.html" });
  });

  it("shows a product page instead of claiming success when cart selection is required", async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: "Choose size" });

    await expect(addOutfitToCarts([shirt])).resolves.toEqual({ added: 0, needs_attention: ["Blue shirt"], carts_opened: 0 });
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(10, { active: true, url: shirt.product_url });
  });

  it("retries while the product content script finishes loading", async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({ ok: true });

    const pending = addOutfitToCarts([shirt]);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ added: 1 });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("ignores malformed messages without opening an arbitrary URL", async () => {
    await expect(addOutfitToCarts([null, { platform: "amazon_in", title: "Fake", product_url: "https://evil.example/item" }])).resolves.toEqual({ added: 0, needs_attention: [], carts_opened: 0 });
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("uses one tab for every item and finishes on the last retailer cart", async () => {
    const shoes: OutfitItem = { ...shirt, platform: "flipkart", title: "Shoes", product_type: "footwear", product_url: "https://flipkart.com/shoes/p/SHOE" };
    const pending = addOutfitToCarts([shirt, shoes]);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ added: 2, needs_attention: [], carts_opened: 1 });
    expect(chrome.tabs.update).toHaveBeenNthCalledWith(1, 10, { active: true, url: shirt.product_url });
    expect(chrome.tabs.update).toHaveBeenNthCalledWith(2, 10, { active: true, url: shoes.product_url });
    expect(chrome.tabs.update).toHaveBeenNthCalledWith(3, 10, { active: true, url: "https://www.flipkart.com/rv/viewcart" });
  });
});
