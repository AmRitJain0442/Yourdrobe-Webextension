import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteActiveOutfit, deleteProfile, LocalProfileAssetMissingError, loadActiveOutfit, loadProfile, loadRequiredAssets, saveActiveOutfit, saveYouCamConsent } from "../profile/store";
import type { ActiveOutfit, ProfileMetadata } from "../profile/types";
import type { ProductType, TryOnJob } from "../types";
import { getResultImage } from "./api";
import { App } from "./App";

vi.mock("../profile/store", () => ({
  loadProfile: vi.fn(),
  loadRequiredAssets: vi.fn(),
  loadLegacyImage: vi.fn().mockResolvedValue(null),
  loadActiveOutfit: vi.fn(),
  saveActiveOutfit: vi.fn(),
  deleteActiveOutfit: vi.fn(),
  deleteProfile: vi.fn(),
  saveYouCamConsent: vi.fn(),
  LocalProfileAssetMissingError: class extends Error {},
}));

let root: Root | null;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let capabilities: { tryon_provider: "mock" | "youcam"; live_product_types: ProductType[] };
let batchJob: TryOnJob;
let onTabUpdated: ((tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void) | undefined;
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
  assets: {
    face_front: { role: "face_front", mime_type: "image/png", width: 720, height: 720, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" },
    face_left: { role: "face_left", mime_type: "image/png", width: 720, height: 720, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" },
    face_right: { role: "face_right", mime_type: "image/png", width: 720, height: 720, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" },
    full_body_front: { role: "full_body_front", mime_type: "image/png", width: 720, height: 1280, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" },
    full_body_side: { role: "full_body_side", mime_type: "image/png", width: 720, height: 1280, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" },
  },
  attributes: {},
};
const activeTop: ActiveOutfit = {
  metadata: {
    version: 1,
    job_id: "saved-job",
    product_id: "saved-top",
    product_title: "Saved linen top",
    product_type: "top",
    product_url: "https://amazon.in/dp/TOP",
    mime_type: "image/jpeg",
    byte_size: 6,
    saved_at: "2026-08-16T00:00:00.000Z",
  },
  image_data_url: "data:image/jpeg;base64,active",
};
const activeDress: ActiveOutfit = {
  metadata: {
    ...activeTop.metadata,
    job_id: "job",
    product_id: "product",
    product_title: product.title,
    product_type: "dress",
    product_url: product.product_url,
  },
  image_data_url: "data:image/jpeg;base64,cmVuZGVy",
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
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.chrome = {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: true, products: [product] }),
      onUpdated: {
        addListener: vi.fn((listener) => { onTabUpdated = listener; }),
        removeListener: vi.fn(),
      },
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } },
  } as unknown as typeof chrome;
  vi.mocked(loadProfile).mockResolvedValue(null);
  vi.mocked(loadActiveOutfit).mockResolvedValue(null);
  vi.mocked(loadRequiredAssets).mockResolvedValue([]);
  vi.mocked(saveActiveOutfit).mockResolvedValue(activeDress);
  vi.mocked(deleteActiveOutfit).mockResolvedValue();
  vi.mocked(deleteProfile).mockResolvedValue();
  vi.mocked(saveYouCamConsent).mockResolvedValue({ ...fullBodyProfile, youcam_consented_at: "2026-08-16T00:00:00.000Z" });
  capabilities = { tryon_provider: "mock", live_product_types: [] };
  batchJob = { job_id: "job", product_id: "product", status: "completed", mock: true, result_url: "https://example.com/result.jpg" };
  fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/tryons/job/result-image")) {
      return Promise.resolve(new Response("render", { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    }
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
  onTabUpdated = undefined;
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
  it("refreshes products when the active shopping page finishes navigating", async () => {
    await renderApp();
    expect(host.textContent).toContain("Daily essential");
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      products: [{ ...product, title: "Baggy jeans", product_url: "https://amazon.in/dp/JEANS", product_type: "bottom" }],
    });

    await act(async () => {
      onTabUpdated?.(1, { status: "complete" }, { id: 1, active: true } as chrome.tabs.Tab);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Baggy jeans");
    expect(host.textContent).not.toContain("Daily essential");
  });

  it("requires all five core photos even when the product source photo exists", async () => {
    vi.mocked(loadProfile).mockResolvedValue({
      ...fullBodyProfile,
      assets: { full_body_front: fullBodyProfile.assets.full_body_front },
    });
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });

    await renderApp();
    await click("Try these products");

    expect(host.textContent).toContain("4 of 5 required photos still needed");
    expect(host.textContent).toContain("Front face photo");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/sessions"))).toBe(false);
  });

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

  it("saves a completed live result as the active outfit", async () => {
    mockCapabilities("youcam", ["dress"]);
    mockCompletedJob();

    await completeRun();
    await click("Use as active outfit");

    expect(saveActiveOutfit).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({
      job_id: "job", product_id: "product", product_type: "dress",
    }));
    expect(host.textContent).toContain("Active outfit");
    expect(host.textContent).toContain("Saved browser-locally on this device.");
    expect(host.textContent).toContain("uploads this saved image to Perfect Corp");
  });

  it("accepts a PNG completed-live image from the local backend", async () => {
    mockCompletedJob();
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/tryons/job/result-image")) {
        return Promise.resolve(new Response("render", { status: 200, headers: { "Content-Type": "image/png" } }));
      }
      const body = url.endsWith("/capabilities") ? capabilities
        : url.endsWith("/sessions") ? { session_id: "session" }
          : url.endsWith("/profiles") ? { profile_id: "profile" }
            : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
              : { jobs: [batchJob] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });

    await completeRun();
    await click("Use as active outfit");

    expect((vi.mocked(saveActiveOutfit).mock.calls[0][0] as Blob).type).toBe("image/png");
  });

  it("uses a saved top as the shared source for later bottoms", async () => {
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    const secondProduct = { ...product, title: "Second bottom", product_url: "https://amazon.in/dp/BOTTOM2", product_type: "bottom" as const };
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      products: [{ ...product, product_type: "bottom" }, secondProduct],
    });
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      const body = url.endsWith("/capabilities") ? capabilities
        : url.endsWith("/sessions") ? { session_id: "session" }
          : url.endsWith("/profiles") ? { profile_id: "profile" }
            : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "bottom", id: "product" }, { ...secondProduct, id: "product-2" }] }
              : { jobs: [
                { job_id: "job", product_id: "product", status: "completed", mock: true, result_url: "https://example.com/one.jpg" },
                { job_id: "job-2", product_id: "product-2", status: "completed", mock: true, result_url: "https://example.com/two.jpg" },
              ] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });

    await renderApp();

    const panel = host.querySelector("article.active-outfit") as HTMLElement;
    expect(panel.textContent).toContain("Saved linen top");
    expect(panel.textContent).toContain("top");
    expect(panel.querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,active");
    expect(panel.querySelector('a[href="https://amazon.in/dp/TOP"]')).not.toBeNull();

    await click("Try these products");

    expect(loadRequiredAssets).toHaveBeenCalledWith([]);
    const batch = requestBody("/tryons/batch");
    expect(batch.product_ids).toEqual(["product", "product-2"]);
    expect(batch.outfit_base_image_data_url).toBe("data:image/jpeg;base64,active");
    expect(batch.assets).toEqual([]);
    expect(requestBody("/products/normalize").products).toHaveLength(2);
  });

  it("keeps the original full-body asset for a bag when an active outfit exists", async () => {
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "bag" }] });

    await renderApp();
    expect(host.querySelector("article.active-outfit")?.textContent).toContain("Saved linen top");
    await click("Try these products");

    expect(loadRequiredAssets).toHaveBeenCalledWith(["full_body_front"]);
    expect(requestBody("/tryons/batch").assets).toEqual([
      { kind: "full_body_front", image_data_url: "data:image/png;base64,profile" },
    ]);
    expect(requestBody("/tryons/batch")).not.toHaveProperty("outfit_base_image_data_url");
  });

  it("uses the active base for a top while retaining the original full-body asset for a bag", async () => {
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      products: [{ ...product, product_type: "top" }, { ...product, title: "Canvas bag", product_url: "https://amazon.in/dp/BAG", product_type: "bag" }],
    });

    await renderApp();
    expect(host.querySelector("article.active-outfit")?.textContent).toContain("Saved linen top");
    await click("Try these products");

    const batch = requestBody("/tryons/batch");
    expect(loadRequiredAssets).toHaveBeenCalledWith(["full_body_front"]);
    expect(batch.assets).toEqual([
      { kind: "full_body_front", image_data_url: "data:image/png;base64,profile" },
    ]);
    expect(batch.outfit_base_image_data_url).toBe("data:image/jpeg;base64,active");
  });

  it.each([
    ["mock", { status: "completed", mock: true, result_url: "https://example.com/mock.jpg" }],
    ["failed", { status: "failed", mock: false, result_url: "https://provider.example/result.jpg" }],
    ["incomplete", { status: "completed", mock: false, result_url: "" }],
    ["unverified", { status: "completed", mock: undefined, result_url: "https://provider.example/result.jpg" }],
  ] as const)("does not offer active-outfit saving for a %s result", async (_label, overrides) => {
    mockCompletedJob(overrides);
    await completeRun();
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Use as active outfit")).toBe(false);
  });

  it("preserves the previous outfit when saving fails", async () => {
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(saveActiveOutfit).mockRejectedValue(new Error("Storage unavailable."));
    mockCompletedJob();

    await completeRun();
    await click("Use as active outfit");

    expect(host.querySelector("article.active-outfit")?.textContent).toContain("Saved linen top");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable.");
  });

  it("preserves the previous outfit when reset fails", async () => {
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(deleteActiveOutfit).mockRejectedValue(new Error("Storage unavailable."));

    await renderApp();
    await click("Reset to original profile photo");

    expect(host.querySelector("article.active-outfit")?.textContent).toContain("Saved linen top");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Storage unavailable.");
  });

  it("resets the active outfit and restores original profile sourcing", async () => {
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadRequiredAssets).mockResolvedValue([{ kind: "full_body_front", image_data_url: "data:image/png;base64,profile" }]);
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });

    await renderApp();
    await click("Reset to original profile photo");
    await click("Try these products");

    expect(deleteActiveOutfit).toHaveBeenCalledOnce();
    expect(loadRequiredAssets).toHaveBeenCalledWith(["full_body_front"]);
    expect(requestBody("/tryons/batch")).not.toHaveProperty("outfit_base_image_data_url");
  });

  it("keeps active-outfit save single-flight and disabled while busy", async () => {
    let finishSave!: (value: ActiveOutfit) => void;
    vi.mocked(saveActiveOutfit).mockReturnValue(new Promise((resolve) => { finishSave = resolve; }));
    mockCompletedJob();
    await completeRun();
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Use as active outfit") as HTMLButtonElement;

    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveActiveOutfit).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Saving active outfit");

    await act(async () => { finishSave(activeDress); await Promise.resolve(); });
  });

  it("blocks profile management while an active-outfit download is pending", async () => {
    let finishDownload!: (response: Response) => void;
    mockCompletedJob();
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/tryons/job/result-image")) {
        return new Promise((resolve) => { finishDownload = resolve; });
      }
      const body = url.endsWith("/capabilities") ? capabilities
        : url.endsWith("/sessions") ? { session_id: "session" }
          : url.endsWith("/profiles") ? { profile_id: "profile" }
            : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
              : { jobs: [batchJob] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    await completeRun();
    const saveButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "Use as active outfit") as HTMLButtonElement;
    const manageButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "Manage profile") as HTMLButtonElement;

    await act(async () => {
      saveButton.click();
      manageButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("Manage your profile");
    expect(([...host.querySelectorAll("button")].find((item) => item.textContent === "Manage profile") as HTMLButtonElement).disabled).toBe(true);
    expect(saveActiveOutfit).not.toHaveBeenCalled();

    await act(async () => {
      finishDownload(new Response("render", { status: 200, headers: { "Content-Type": "image/jpeg" } }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveActiveOutfit).toHaveBeenCalledOnce();
  });

  it("keeps active-outfit reset single-flight and disabled while busy", async () => {
    let finishReset!: () => void;
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(deleteActiveOutfit).mockReturnValue(new Promise((resolve) => { finishReset = resolve; }));
    await renderApp();
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Reset to original profile photo") as HTMLButtonElement;

    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(deleteActiveOutfit).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Resetting active outfit");

    await act(async () => { finishReset(); await Promise.resolve(); });
  });

  it("blocks Try while resetting an active outfit", async () => {
    let finishReset!: () => void;
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(deleteActiveOutfit).mockReturnValue(new Promise((resolve) => { finishReset = resolve; }));
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, products: [{ ...product, product_type: "dress" }] });
    await renderApp();
    const resetButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "Reset to original profile photo") as HTMLButtonElement;
    const tryButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "Try these products") as HTMLButtonElement;

    await act(async () => {
      resetButton.click();
      tryButton.click();
      await Promise.resolve();
    });

    expect(deleteActiveOutfit).toHaveBeenCalledOnce();
    expect(tryButton.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => { finishReset(); await Promise.resolve(); });
    expect(tryButton.disabled).toBe(false);
  });

  it.each([
    ["non-image", new Response("html", { status: 200, headers: { "Content-Type": "text/html" } })],
    ["empty", new Response(new Blob([], { type: "image/jpeg" }), { status: 200 })],
    ["too large", new Response(new Blob([new Uint8Array(10 * 1024 * 1024)], { type: "image/png" }), { status: 200 })],
    ["failed", new Response("no", { status: 502 })],
  ])("rejects a %s backend result image without replacing the active outfit", async (_label, imageResponse) => {
    vi.mocked(loadActiveOutfit).mockResolvedValue(activeTop);
    mockCompletedJob();
    fetchMock.mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/tryons/job/result-image")) return Promise.resolve(imageResponse);
      const body = url.endsWith("/capabilities") ? capabilities
        : url.endsWith("/sessions") ? { session_id: "session" }
          : url.endsWith("/profiles") ? { profile_id: "profile" }
            : url.endsWith("/products/normalize") ? { products: [{ ...product, product_type: "dress", id: "product" }] }
              : { jobs: [batchJob] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });

    await completeRun();
    await click("Use as active outfit");

    expect(saveActiveOutfit).not.toHaveBeenCalled();
    expect(host.querySelector("article.active-outfit")?.textContent).toContain("Saved linen top");
    const message = host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(message).toContain("local backend");
    expect(message).not.toContain("provider.example");
  });

  it("times out an active-outfit image download after ten seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));

    let settled = false;
    const pending = getResultImage("job");
    void pending.then(() => { settled = true; }, () => { settled = true; });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toThrow("The local backend took too long. Please try again.");
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

  it("refreshes to no active outfit after complete-profile deletion", async () => {
    vi.mocked(loadProfile).mockResolvedValue(fullBodyProfile);
    vi.mocked(loadActiveOutfit).mockResolvedValueOnce(activeTop).mockResolvedValueOnce(null);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

    await renderApp();
    expect(host.querySelector("article.active-outfit")?.textContent).toContain("Saved linen top");
    await click("Manage profile");
    await click("Delete complete profile");

    expect(loadActiveOutfit).toHaveBeenCalledTimes(2);
    expect(host.querySelector("article.active-outfit")).toBeNull();
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
