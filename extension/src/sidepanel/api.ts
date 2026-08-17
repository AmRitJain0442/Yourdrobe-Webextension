import type { Product, ProductType, TryOnJob } from "../types";
import type { ProfileAssetUpload, ProfileAttributes, RequirementKey } from "../profile/types";
import { profilePhotoRoles } from "../profile/requirements";

export const baseUrl = (import.meta.env.VITE_API_BASE_URL
  || "https://yourdrobe-api-jiayjiprgq-el.a.run.app/v1").replace(/\/$/, "");
const requestTimeoutMs = 10_000;
const batchTimeoutMs = 300_000;
const profileGenerationTimeoutMs = 300_000;
const maxResultImageBytes = 10 * 1024 * 1024;
const acceptedResultImageTypes = new Set(["image/jpeg", "image/png"]);
export type NormalizedProduct = Product & { id: string };
export type Capabilities = {
  tryon_provider: "mock" | "youcam";
  live_product_types: ProductType[];
  youcam_product_types?: ProductType[];
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
      throw new Error("The Yourdrobe service took too long. Please try again.");
    }
    throw new Error("The Yourdrobe service is unavailable. Please try again.");
  }
  let body: T;
  try {
    body = JSON.parse(raw) as T;
  } catch {
    throw new Error(response.ok
      ? "The Yourdrobe service returned an unexpected response. Please try again."
      : "The Yourdrobe service could not process the request. Please try again.");
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
    if (path === "/profiles/generate-assets" && typeof detail === "string" && detail.length <= 200) {
      throw new Error(detail);
    }
    throw new Error("The Yourdrobe service could not process the request. Please try again.");
  }
  return body;
}

export const getCapabilities = (signal?: AbortSignal) =>
  json<Capabilities>("/capabilities", { signal });

export async function generateProfileAssets(imageDataUrl: string, signal?: AbortSignal): Promise<ProfileAssetUpload[]> {
  const result = await json<{ assets?: unknown }>("/profiles/generate-assets", {
    method: "POST",
    signal,
    body: JSON.stringify({ image_data_url: imageDataUrl, cloud_consent: true }),
  }, profileGenerationTimeoutMs);
  if (!Array.isArray(result.assets) || result.assets.length !== profilePhotoRoles.length) {
    throw new Error("The Yourdrobe service returned an incomplete generated profile.");
  }
  const assets = result.assets.filter((asset): asset is ProfileAssetUpload => {
    if (!asset || typeof asset !== "object") return false;
    const value = asset as Record<string, unknown>;
    return profilePhotoRoles.includes(value.kind as typeof profilePhotoRoles[number])
      && typeof value.image_data_url === "string"
      && value.image_data_url.startsWith("data:image/");
  });
  if (assets.length !== profilePhotoRoles.length
    || new Set(assets.map((asset) => asset.kind)).size !== profilePhotoRoles.length) {
    throw new Error("The Yourdrobe service returned an incomplete generated profile.");
  }
  return profilePhotoRoles.map((role) => assets.find((asset) => asset.kind === role)!);
}

export async function getResultImage(jobId: string, signal?: AbortSignal): Promise<Blob> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)])
    : AbortSignal.timeout(requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/tryons/${encodeURIComponent(jobId)}/result-image`, { signal: requestSignal });
  } catch (reason) {
    if (reason instanceof DOMException && (reason.name === "AbortError" || reason.name === "TimeoutError")) {
      throw new Error("The Yourdrobe service took too long. Please try again.");
    }
    throw new Error("The Yourdrobe service is unavailable. Please try again.");
  }
  if (!response.ok) throw new Error("The Yourdrobe service could not provide that preview. Please try again.");
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new Error("The Yourdrobe service could not provide that preview. Please try again.");
  }
  if (!acceptedResultImageTypes.has(blob.type) || !blob.size || blob.size >= maxResultImageBytes) {
    throw new Error("The Yourdrobe service could not provide that preview. Please try again.");
  }
  return blob;
}

export async function startDemo(
  assets: ProfileAssetUpload[],
  attributes: ProfileAttributes,
  products: Product[],
  cloudConsent: boolean,
  outfitBaseImageDataUrl?: string,
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
      outfit_base_image_data_url: outfitBaseImageDataUrl,
    }),
  }, batchTimeoutMs);
  return { products: normalized.products, jobs: batch.jobs };
}

export const getJob = (jobId: string, signal?: AbortSignal) => json<TryOnJob>(`/tryons/${jobId}`, { signal });
