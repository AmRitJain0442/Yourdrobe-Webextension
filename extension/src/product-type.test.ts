import { describe, expect, it } from "vitest";
import { classifyProductType } from "./product-type";

describe("classifyProductType", () => {
  it.each([
    ["Ruby lipstick", "makeup", "makeup"],
    ["Polarized sunglasses", "other", "eyewear"],
    ["Gold hoop earrings", "other", "earrings"],
    ["Linen dress", "apparel", "dress"],
    ["Leather wrist watch", "other", "watch"],
    ["Running shoes", "other", "footwear"],
  ] as const)("classifies %s", (title, category, expected) => {
    expect(classifyProductType(title, category)).toBe(expected);
  });

  it("does not guess an unrelated product type", () => {
    expect(classifyProductType("Daily essential", "other")).toBe("unknown");
  });
});
