import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { missingRequirements, requirementsForProducts, rolesForRequirement } from "./requirements";

const product = (product_type: Product["product_type"]): Product => ({
  platform: "amazon_in", title: String(product_type), category: "other",
  product_type, image_url: "https://img.example/item.jpg",
  product_url: "https://amazon.in/dp/ITEM", metadata: {},
});

describe("profile requirements", () => {
  it("deduplicates a mixed batch in stable order", () => {
    expect(requirementsForProducts([
      product("makeup"), product("eyewear"), product("dress"), product("watch"), product("footwear"),
    ])).toEqual(["face_front", "full_body_front", "hand_wrist", "feet_front"]);
  });

  it("requires one full-body image for every live clothing type", () => {
    expect(requirementsForProducts([
      product("top"), product("outerwear"), product("bottom"), product("dress"),
    ])).toEqual(["full_body_front"]);
    expect(missingRequirements([product("top")], ["upper_body_front"]))
      .toEqual(["full_body_front"]);
  });

  it("accepts either hand for jewellery", () => {
    expect(missingRequirements([product("ring")], ["right_hand_wrist"])).toEqual([]);
    expect(rolesForRequirement("hand_wrist")).toEqual(["left_hand_wrist", "right_hand_wrist"]);
  });

  it("returns only unsatisfied requirements", () => {
    expect(missingRequirements([product("top"), product("dress")], ["upper_body_front"]))
      .toEqual(["full_body_front"]);
  });
});
