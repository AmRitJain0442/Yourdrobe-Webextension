import type { Product, ProductType, TryOnJob } from "../types";
import type { ProfileAssetUpload, ProfileAttributes, RequirementKey } from "../profile/types";

const baseUrl = "http://127.0.0.1:8001/v1";
const requestTimeoutMs = 10_000;
const batchTimeoutMs = 300_000;
export type NormalizedProduct = Product & { id: string };
export type Capabilities = {
  tryon_provider: "mock" | "youcam";
  live_product_types: ProductType[];
};

export class MissingProfileAssetsError extends Error {
  constructor(readonly roles: RequirementKey[]) {
    super("Additional profile photos are required.");
  }
}

async function json<T>(path: string, init?: RequestInit, timeoutMs = requestTimeoutMs): Promise<T> {
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  let response: Response;
  let raw: string;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    raw = await response.text();
  } catch (reason) {
    if (reason instanceof DOMException && (reason.name === "AbortError" || reason.name === "TimeoutError")) {
      throw new Error("The local backend took too long. Please try again.");
    }
    throw new Error("The local backend is unavailable. Start it and try again.");
  }
  let body: T;
  try {
    body = JSON.parse(raw) as T;
  } catch {
    throw new Error(response.ok
      ? "The local backend returned an unexpected response. Restart it and try again."
      : "The local backend could not process the request. Please try again.");
  }
  if (!response.ok) {
    const detail = (body as { detail?: unknown }).detail;
    if (response.status === 422
      && typeof detail === "object" && detail !== null
      && (detail as { code?: unknown }).code === "missing_profile_assets"
      && Array.isArray((detail as { roles?: unknown }).roles)
      && (detail as { roles: unknown[] }).roles.every((role) => typeof role === "string")) {
      throw new MissingProfileAssetsError((detail as { roles: RequirementKey[] }).roles);
    }
    throw new Error("The local backend could not process the request. Please try again.");
  }
  return body;
}

export const getCapabilities = (signal?: AbortSignal) =>
  json<Capabilities>("/capabilities", { signal });

export async function startDemo(
  assets: ProfileAssetUpload[],
  attributes: ProfileAttributes,
  products: Product[],
  cloudConsent: boolean,
  signal?: AbortSignal,
) {
  const session = await json<{ session_id: string }>("/sessions", { method: "POST", body: "{}", signal });
  const profile = await json<{ profile_id: string }>("/profiles", {
    method: "POST",
    signal,
    body: JSON.stringify({ session_id: session.session_id, assets, attributes, consent: true }),
  });
  const normalized = await json<{ products: NormalizedProduct[] }>("/products/normalize", {
    method: "POST",
    signal,
    body: JSON.stringify({ platform: products[0].platform, products }),
  });
  const batch = await json<{ jobs: TryOnJob[] }>("/tryons/batch", {
    method: "POST",
    signal,
    body: JSON.stringify({
      session_id: session.session_id,
      profile_id: profile.profile_id,
      product_ids: normalized.products.map((product) => product.id),
      assets,
      cloud_consent: cloudConsent,
    }),
  }, batchTimeoutMs);
  return { products: normalized.products, jobs: batch.jobs };
}

export const getJob = (jobId: string, signal?: AbortSignal) => json<TryOnJob>(`/tryons/${jobId}`, { signal });
