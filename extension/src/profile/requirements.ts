import type { Product, ProductType } from "../types";
import type { PhotoRole, RequirementKey } from "./types";

const requirements: Partial<Record<ProductType, RequirementKey>> = {
  makeup: "full_body_front", eyewear: "full_body_front", headwear: "full_body_front", earrings: "full_body_front",
  necklace: "full_body_front", top: "full_body_front", outerwear: "full_body_front",
  dress: "full_body_front", bottom: "full_body_front", belt: "full_body_front", bag: "full_body_front",
  watch: "full_body_front", bracelet: "full_body_front", ring: "full_body_front", footwear: "full_body_front",
};

export const profilePhotoRoles = [
  "face_front", "face_left", "face_right", "full_body_front", "full_body_side",
] as const satisfies readonly PhotoRole[];

export type ProfilePhotoRole = (typeof profilePhotoRoles)[number];

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
