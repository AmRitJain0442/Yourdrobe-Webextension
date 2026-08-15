import type { Product, ProductType } from "../types";
import type { PhotoRole, RequirementKey } from "./types";

const requirements: Partial<Record<ProductType, RequirementKey>> = {
  makeup: "face_front", eyewear: "face_front", headwear: "face_front", earrings: "face_front",
  necklace: "upper_body_front", top: "upper_body_front", outerwear: "upper_body_front",
  dress: "full_body_front", bottom: "full_body_front", belt: "full_body_front", bag: "full_body_front",
  watch: "hand_wrist", bracelet: "hand_wrist", ring: "hand_wrist", footwear: "feet_front",
};

const alternatives: Record<RequirementKey, readonly PhotoRole[]> = {
  face_front: ["face_front"],
  upper_body_front: ["upper_body_front"],
  full_body_front: ["full_body_front"],
  hand_wrist: ["left_hand_wrist", "right_hand_wrist"],
  feet_front: ["feet_front"],
};

export const rolesForRequirement = (key: RequirementKey) => alternatives[key];

export function requirementsForProducts(products: Product[]): RequirementKey[] {
  const result: RequirementKey[] = [];
  for (const product of products) {
    const requirement = requirements[product.product_type ?? "unknown"];
    if (requirement && !result.includes(requirement)) result.push(requirement);
  }
  return result;
}

export function missingRequirements(products: Product[], available: Iterable<PhotoRole>): RequirementKey[] {
  const roles = new Set(available);
  return requirementsForProducts(products).filter((requirement) =>
    !rolesForRequirement(requirement).some((role) => roles.has(role)),
  );
}
