import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

let root: Root;
let host: HTMLDivElement;
const product = {
  platform: "amazon_in" as const,
  title: "Red shirt",
  price: 999,
  currency: "INR" as const,
  category: "apparel" as const,
  image_url: "https://example.com/shirt.jpg",
  product_url: "https://amazon.in/dp/SHIRT",
  metadata: {},
};

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.chrome = {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: true, products: [product] }),
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } },
  } as unknown as typeof chrome;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("requires consent before storing a selected profile image", async () => {
    await act(async () => { root.render(<App />); });
    const file = new File(["image"], "profile.png", { type: "image/png" });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    vi.stubGlobal("FileReader", class {
      result = "data:image/png;base64,profile";
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL() { this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>); }
    });
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Choose an image and agree to local demo storage.");
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("shows a helpful empty state when a supported page has no products", async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [] });
    await act(async () => { root.render(<App />); });
    expect(host.textContent).toContain("No products found on this page.");
  });

  it("shows a timeout error when previews keep processing", async () => {
    vi.useFakeTimers();
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ yourdrobe_profile_image: "data:image/png;base64,profile" });
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith("/sessions") ? { session_id: "session" }
        : url.endsWith("/profiles") ? { profile_id: "profile" }
          : url.endsWith("/products/normalize") ? { products: [{ ...product, id: "product" }] }
            : url.endsWith("/tryons/batch") ? { jobs: [{ job_id: "job", product_id: "product", status: "processing" }] }
              : { job_id: "job", product_id: "product", status: "processing" };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }));
    await act(async () => { root.render(<App />); });
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(host.textContent).toContain("The preview is taking too long. Please try again.");
  });

  it.each([
    [
      "network",
      () => Promise.reject(new TypeError("Failed to fetch")),
      "The local backend is unavailable. Start it and try again.",
    ],
    [
      "response body network",
      () => Promise.resolve({
        ok: true,
        text: () => Promise.reject(new TypeError("Network connection lost")),
      } as Response),
      "The local backend is unavailable. Start it and try again.",
    ],
    [
      "timeout",
      () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
      "The local backend took too long. Please try again.",
    ],
    [
      "non-JSON",
      () => Promise.resolve(new Response("Bad gateway", { status: 502 })),
      "The local backend could not process the request. Please try again.",
    ],
  ])("shows an actionable %s backend error", async (_label, fetchResult, expected) => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({ yourdrobe_profile_image: "data:image/png;base64,profile" });
    vi.stubGlobal("fetch", vi.fn(fetchResult));
    await act(async () => { root.render(<App />); });
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain(expected);
  });
});
