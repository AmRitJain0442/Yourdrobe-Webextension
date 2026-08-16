import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileAssetUpload } from "../profile/types";
import type { Product } from "../types";
import { startDemo } from "./api";

const asset: ProfileAssetUpload = {
  kind: "full_body_front",
  image_data_url: "data:image/jpeg;base64,profile",
};
const product: Product = {
  platform: "amazon_in",
  title: "Top",
  category: "apparel",
  product_type: "top",
  image_url: "https://images.example/top.jpg",
  product_url: "https://amazon.in/dp/TOP",
  metadata: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startDemo", () => {
  it("sends the active outfit only as the batch base image", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      const body = url.endsWith("/sessions") ? { session_id: "session" }
        : url.endsWith("/profiles") ? { profile_id: "profile" }
          : url.endsWith("/products/normalize") ? { products: [{ ...product, id: "product" }] }
            : { jobs: [] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await startDemo([asset], {}, [product], true, "data:image/jpeg;base64,active");

    const request = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/tryons/batch"));
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      session_id: "session",
      profile_id: "profile",
      product_ids: ["product"],
      assets: [asset],
      cloud_consent: true,
      outfit_base_image_data_url: "data:image/jpeg;base64,active",
    });
  });
});
