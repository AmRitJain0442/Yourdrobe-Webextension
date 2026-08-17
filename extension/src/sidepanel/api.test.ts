import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileAssetUpload } from "../profile/types";
import type { Product } from "../types";
import { baseUrl, generateProfileAssets, startDemo } from "./api";

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
  it("uses the hosted API by default", () => {
    expect(baseUrl).toBe("https://yourdrobe-api-jiayjiprgq-el.a.run.app/v1");
  });

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

describe("generateProfileAssets", () => {
  it("shows the backend's safe profile-generation failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: "AI profile generation quota is temporarily exhausted. Try again shortly.",
    }), { status: 502 })));

    await expect(generateProfileAssets("data:image/jpeg;base64,source"))
      .rejects.toThrow("AI profile generation quota is temporarily exhausted. Try again shortly.");
  });

  it("sends cloud consent and returns all five roles in profile order", async () => {
    const roles = ["full_body_side", "face_right", "full_body_front", "face_left", "face_front"] as const;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      assets: roles.map((kind) => ({ kind, image_data_url: `data:image/jpeg;base64,${kind}` })),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateProfileAssets("data:image/jpeg;base64,source");

    expect(result.map((asset) => asset.kind)).toEqual(["face_front", "face_left", "face_right", "full_body_front", "full_body_side"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      image_data_url: "data:image/jpeg;base64,source",
      cloud_consent: true,
    });
  });

  it("rejects duplicate or incomplete provider output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      assets: Array.from({ length: 5 }, () => ({ kind: "face_front", image_data_url: "data:image/jpeg;base64,image" })),
    }), { status: 200 })));

    await expect(generateProfileAssets("data:image/jpeg;base64,source")).rejects.toThrow("incomplete generated profile");
  });
});
