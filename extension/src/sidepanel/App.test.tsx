import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalProfileAssetMissingError, loadProfile, loadRequiredAssets } from "../profile/store";
import type { ProfileMetadata } from "../profile/types";
import { App } from "./App";

vi.mock("../profile/store", () => ({
  loadProfile: vi.fn(),
  loadRequiredAssets: vi.fn(),
  loadLegacyImage: vi.fn().mockResolvedValue(null),
  LocalProfileAssetMissingError: class extends Error {},
}));

let root: Root;
let host: HTMLDivElement;
const product = {
  platform: "amazon_in" as const,
  title: "Daily essential",
  price: 999,
  currency: "INR" as const,
  category: "apparel" as const,
  image_url: "https://example.com/dress.jpg",
  product_url: "https://amazon.in/dp/DRESS",
  metadata: {},
};
const fullBodyProfile: ProfileMetadata = {
  version: 2,
  consented_at: "2026-08-15T00:00:00.000Z",
  assets: { full_body_front: { role: "full_body_front", mime_type: "image/png", width: 400, height: 800, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" } },
  attributes: {},
};

async function renderApp() {
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.chrome = {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: true, products: [product] }),
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } },
  } as unknown as typeof chrome;
  vi.mocked(loadProfile).mockResolvedValue(null);
  vi.mocked(loadRequiredAssets).mockResolvedValue([]);
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
  it("opens full-body setup before requesting a dress without profile metadata", async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await renderApp();
    await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });

    expect(host.textContent).toContain("Front full-body photo");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates previews with the concrete required local asset", async () => {
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    const fetchMock = vi.fn((input: string | URL | Request, _init: RequestInit) => {
      const url = String(input);
      const body = url.endsWith("/sessions") ? { session_id: "session" }
        : url.endsWith("/profiles") ? { profile_id: "profile" }
          : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
            : { jobs: [{ job_id: "job", product_id: "product", status: "completed", result_url: "https://example.com/result.jpg" }] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderApp();
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Your previews");
    const profileRequest = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/profiles"));
    expect(profileRequest).toBeDefined();
    expect(JSON.parse(String((profileRequest as [string | URL | Request, RequestInit])[1].body))).toEqual({
      session_id: "session",
      assets: [{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }],
      attributes: {},
      consent: true,
    });
  });

  it("requires a product type selection before choosing its profile requirement", async () => {
    await renderApp();

    expect(host.textContent).toContain("Choose product type for Daily essential");
    const select = host.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "dress";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });

    expect(host.textContent).toContain("Front full-body photo");
  });

  it("reopens setup when the backend reports missing profile roles", async () => {
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith("/sessions") ? { session_id: "session" }
        : url.endsWith("/profiles") ? { profile_id: "profile" }
          : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
            : { detail: { code: "missing_profile_assets", roles: ["full_body_front"] } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: url.endsWith("/tryons/batch") ? 422 : 200 }));
    }));

    await renderApp();
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Front full-body photo");
  });

  it("reopens setup after repairing metadata for a missing local blob", async () => {
    vi.mocked(loadProfile).mockResolvedValueOnce(fullBodyProfile).mockResolvedValueOnce(null);
    vi.mocked(loadRequiredAssets).mockRejectedValue(new LocalProfileAssetMissingError("full_body_front"));
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });

    await renderApp();
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Front full-body photo");
  });

  it("shows a helpful empty state when a supported page has no products", async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [] });
    await renderApp();
    expect(host.textContent).toContain("No products found on this page.");
  });

  it("opens profile management from the ready state", async () => {
    await renderApp();
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Manage profile")?.click(); });
    expect(host.textContent).toContain("Manage your profile");
  });

  it("shows a timeout error when previews keep processing", async () => {
    vi.useFakeTimers();
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith("/sessions") ? { session_id: "session" }
        : url.endsWith("/profiles") ? { profile_id: "profile" }
          : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
            : url.endsWith("/tryons/batch") ? { jobs: [{ job_id: "job", product_id: "product", status: "processing" }] }
              : { job_id: "job", product_id: "product", status: "processing" };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }));
    await renderApp();
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(host.textContent).toContain("The preview is taking too long. Please try again.");
  });

  it.each([
    ["network", () => Promise.reject(new TypeError("Failed to fetch")), "The local backend is unavailable. Start it and try again."],
    ["response body network", () => Promise.resolve({ ok: true, text: () => Promise.reject(new TypeError("Network connection lost")) } as Response), "The local backend is unavailable. Start it and try again."],
    ["timeout", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")), "The local backend took too long. Please try again."],
    ["non-JSON", () => Promise.resolve(new Response("Bad gateway", { status: 502 })), "The local backend could not process the request. Please try again."],
  ])("shows an actionable %s backend error", async (_label, fetchResult, expected) => {
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    vi.stubGlobal("fetch", vi.fn(fetchResult));
    await renderApp();
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain(expected);
  });
});
