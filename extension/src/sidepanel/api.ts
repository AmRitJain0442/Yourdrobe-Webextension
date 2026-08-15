import type { Product, TryOnJob } from "../types";

const baseUrl = "http://127.0.0.1:8000/v1";
export type NormalizedProduct = Product & { id: string };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const signal = init?.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
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
  if (!response.ok) throw new Error("The local backend could not process the request. Please try again.");
  return body;
}

export async function startDemo(imageDataUrl: string, products: Product[], signal?: AbortSignal) {
  const session = await json<{ session_id: string }>("/sessions", { method: "POST", body: "{}", signal });
  const profile = await json<{ profile_id: string }>("/profiles", {
    method: "POST",
    signal,
    body: JSON.stringify({ session_id: session.session_id, image_data_url: imageDataUrl, consent: true }),
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
    }),
  });
  return { products: normalized.products, jobs: batch.jobs };
}

export const getJob = (jobId: string, signal?: AbortSignal) => json<TryOnJob>(`/tryons/${jobId}`, { signal });
