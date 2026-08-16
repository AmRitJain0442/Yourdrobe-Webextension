import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteProfile, LocalProfileAssetMissingError, loadProfile, loadRequiredAssets, saveYouCamConsent } from "../profile/store";
import type { ProfileMetadata } from "../profile/types";
import type { ProductType, TryOnJob } from "../types";
import { App } from "./App";

vi.mock("../profile/store", () => ({
  loadProfile: vi.fn(),
  loadRequiredAssets: vi.fn(),
  loadLegacyImage: vi.fn().mockResolvedValue(null),
  deleteProfile: vi.fn(),
  saveYouCamConsent: vi.fn(),
  LocalProfileAssetMissingError: class extends Error {},
}));

let root: Root | null;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let capabilities: { tryon_provider: "mock" | "youcam"; live_product_types: ProductType[] };
let batchJob: TryOnJob;
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
    root?.render(<App />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockCapabilities(tryon_provider: "mock" | "youcam", live_product_types: ProductType[]) {
  capabilities = { tryon_provider, live_product_types };
}

function mockCompletedJob(overrides: Partial<TryOnJob> = {}) {
  batchJob = { job_id: "job", product_id: "product", status: "completed", mock: false, result_url: "https://provider.example/result.jpg", ...overrides };
}

function requestBody(path: string) {
  const request = fetchMock.mock.calls.find(([input]) => String(input).endsWith(path));
  expect(request).toBeDefined();
  return JSON.parse(String((request as [string | URL | Request, RequestInit])[1].body)) as Record<string, unknown>;
}

async function click(name: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === name)?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function checkYouCamConsentAndAccept() {
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  await click("Agree and create live preview");
}

async function completeRun() {
  vi.mocked(loadProfile).mockResolvedValue({ ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" });
  vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
  (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
  await renderApp();
  await click("Try these products");
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
  vi.mocked(deleteProfile).mockResolvedValue();
  vi.mocked(saveYouCamConsent).mockResolvedValue({ ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" });
  capabilities = { tryon_provider: "mock", live_product_types: [] };
  batchJob = { job_id: "job", product_id: "product", status: "completed", mock: true, result_url: "https://example.com/result.jpg" };
  fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const body = url.endsWith("/capabilities") ? capabilities
      : url.endsWith("/sessions") ? { session_id: "session" }
        : url.endsWith("/profiles") ? { profile_id: "profile" }
          : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
            : url.endsWith("/tryons/batch") ? { jobs: [batchJob] }
              : batchJob;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
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
      const body = url.endsWith("/capabilities") ? { tryon_provider: "mock", live_product_types: [] }
        : url.endsWith("/sessions") ? { session_id: "session" }
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

  it("requests one-time YouCam consent before the first live clothing run", async () => {
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    mockCapabilities("youcam", ["dress"]);

    await renderApp();
    await click("Try these products");

    expect(host.textContent).toContain("Enable live YouCam previews");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/tryons/batch"))).toBe(false);
  });

  it("records consent and resumes the live run", async () => {
    const consented = { ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" };
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    vi.mocked(saveYouCamConsent).mockResolvedValue(consented);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    mockCapabilities("youcam", ["dress"]);

    await renderApp();
    await click("Try these products");
    await checkYouCamConsentAndAccept();

    expect(saveYouCamConsent).toHaveBeenCalledOnce();
    const batch = requestBody("/tryons/batch");
    expect(batch.assets).toEqual([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    expect(batch.cloud_consent).toBe(true);
  });

  it("does not repeat consent for an already-consented profile", async () => {
    vi.mocked(loadProfile).mockResolvedValue({ ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" });
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    mockCapabilities("youcam", ["dress"]);

    await renderApp();
    await click("Try these products");

    expect(host.textContent).not.toContain("Enable live YouCam previews");
    expect(requestBody("/tryons/batch").cloud_consent).toBe(true);
  });

  it("does not resume a live run after unmount while consent is saving", async () => {
    let finishConsent!: (profile: ProfileMetadata) => void;
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    vi.mocked(saveYouCamConsent).mockReturnValue(new Promise((resolve) => { finishConsent = resolve; }));
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    mockCapabilities("youcam", ["dress"]);

    await renderApp();
    await click("Try these products");
    await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await click("Agree and create live preview");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/capabilities"))).toHaveLength(1);
    act(() => root?.unmount());
    root = null;
    await act(async () => {
      finishConsent({ ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/capabilities"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/tryons/batch"))).toBe(false);
  });

  it("labels completed live results without a mock fallback", async () => {
    mockCapabilities("youcam", ["dress"]);
    mockCompletedJob({ mock: false, result_url: "https://provider.example/result.jpg" });

    await completeRun();

    expect(host.textContent).toContain("YouCam AI preview");
    expect(host.textContent).not.toContain("Mock AI preview");
    expect(host.querySelector("img")?.alt).toBe("Preview of Daily essential");
    expect(JSON.stringify((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("provider.example/result.jpg");
  });

  it("does not show the listing image as a completed live result", async () => {
    mockCapabilities("youcam", ["dress"]);
    mockCompletedJob({ mock: false, result_url: "" });

    await completeRun();

    expect(host.textContent).toContain("This product preview failed.");
    expect(host.querySelector("article.product img")).toBeNull();
  });

  it("shows the provider failure and original listing", async () => {
    mockCapabilities("youcam", ["dress"]);
    mockCompletedJob({ status: "failed", mock: false, error_code: "invalid_product_image", error_message: "YouCam could not use this product image." });

    await completeRun();

    expect(host.textContent).toContain("YouCam could not use this product image.");
    expect(host.textContent).not.toContain("Mock AI preview");
    expect(host.querySelector('a[href="https://amazon.in/dp/DRESS"]')).not.toBeNull();
  });

  it("keeps mock mode and sends no cloud consent", async () => {
    mockCapabilities("mock", []);
    mockCompletedJob({ mock: true, result_url: "https://example.com/mock-result.jpg" });
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });

    await renderApp();
    await click("Try these products");

    expect(requestBody("/tryons/batch").cloud_consent).toBe(false);
    expect(host.textContent).toContain("Mock AI preview");
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
      const body = url.endsWith("/capabilities") ? { tryon_provider: "mock", live_product_types: [] }
        : url.endsWith("/sessions") ? { session_id: "session" }
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

  it("keeps profile deletion busy until App reloads the cleared profile", async () => {
    let finishReload!: (value: ProfileMetadata | null) => void;
    const reloaded = new Promise<ProfileMetadata | null>((resolve) => { finishReload = resolve; });
    vi.mocked(loadProfile).mockResolvedValueOnce({ ...fullBodyProfile, attributes: { height_cm: 170 } }).mockReturnValueOnce(reloaded);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    await renderApp();
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Manage profile")?.click(); });

    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Delete complete profile")?.click();
      await Promise.resolve();
    });

    expect(deleteProfile).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Manage your profile");
    expect(([...host.querySelectorAll("button")].find((button) => button.textContent === "Close") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      finishReload(null);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("Manage your profile");
    expect(host.textContent).toContain("products ready");
  });

  it("polls processing jobs every two seconds", async () => {
    vi.useFakeTimers();
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    batchJob = { job_id: "job", product_id: "product", status: "processing", mock: true };
    await renderApp();
    await click("Try these products");

    const pollCount = () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/tryons/job")).length;
    expect(pollCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(pollCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(pollCount()).toBe(1);
  });

  it("allows a live batch request to outlast the normal backend call timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    vi.mocked(loadProfile).mockResolvedValue({ ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" });
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    mockCapabilities("youcam", ["dress"]);
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/tryons/batch")) return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(JSON.stringify({ jobs: [{ job_id: "job", product_id: "product", status: "completed", mock: false, result_url: "https://provider.example/result.jpg" }] }), { status: 200 })), 15_000);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
      });
      const body = url.endsWith("/capabilities") ? capabilities
        : url.endsWith("/sessions") ? { session_id: "session" }
          : url.endsWith("/profiles") ? { profile_id: "profile" }
            : { products: [{ ...product, product_type: "dress", id: "product" }] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderApp();
    await click("Try these products");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(host.textContent).toContain("Creating your previews...");
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(host.textContent).toContain("Your previews");
  });

  it("stops after 40 polls with the timeout message", async () => {
    vi.useFakeTimers();
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    batchJob = { job_id: "job", product_id: "product", status: "processing", mock: true };

    await renderApp();
    await click("Try these products");
    await act(async () => { await vi.advanceTimersByTimeAsync(80_000); });

    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/tryons/job"))).toHaveLength(40);
    expect(host.textContent).toContain("The preview is taking too long. Please try again.");
  });

  it("uses an 80-second wall-clock deadline when polling responses are slow", async () => {
    vi.useFakeTimers();
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    batchJob = { job_id: "job", product_id: "product", status: "processing", mock: true };
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/tryons/job")) return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(JSON.stringify(batchJob), { status: 200 })), 9_000);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal?.reason); }, { once: true });
      });
      const body = url.endsWith("/capabilities") ? capabilities
        : url.endsWith("/sessions") ? { session_id: "session" }
          : url.endsWith("/profiles") ? { profile_id: "profile" }
            : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
              : { jobs: [batchJob] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderApp();
    await click("Try these products");
    await act(async () => { await vi.advanceTimersByTimeAsync(80_000); });

    expect(host.textContent).toContain("The preview is taking too long. Please try again.");
  });

  it("does not poll again after unmount", async () => {
    vi.useFakeTimers();
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    batchJob = { job_id: "job", product_id: "product", status: "processing", mock: true };

    await renderApp();
    await click("Try these products");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    const pollsAtUnmount = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/tryons/job")).length;
    act(() => root?.unmount());
    root = null;
    await act(async () => { await vi.advanceTimersByTimeAsync(80_000); });

    expect(pollsAtUnmount).toBe(1);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/tryons/job"))).toHaveLength(1);
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
