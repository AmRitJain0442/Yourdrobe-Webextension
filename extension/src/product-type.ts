import type { Product, ProductType } from "./types";

const rules: Array<[RegExp, ProductType]> = [
  [/\b(?:lipsticks?|foundations?|concealers?|blush(?:es)?|mascaras?|eyeliners?|makeup)\b/i, "makeup"],
  [/\b(?:sunglasses?|eyeglasses?|spectacles?|frames?)\b/i, "eyewear"],
  [/\b(?:hats?|caps?|beanies|headbands?)\b/i, "headwear"],
  [/\b(?:earrings?|studs?|hoops?)\b/i, "earrings"],
  [/\b(?:necklaces?|pendants?|chains?)\b/i, "necklace"],
  [/\bwatch(?:es)?\b/i, "watch"],
  [/\b(?:bracelets?|bangles?)\b/i, "bracelet"],
  [/\brings?\b/i, "ring"],
  [/\b(?:shoes?|sneakers?|sandals?|heels?|boots?|slippers?|loafers?)\b/i, "footwear"],
  [/\b(?:dress(?:es)?|gowns?|sarees?|jumpsuits?)\b/i, "dress"],
  [/\b(?:jeans?|trousers?|pants?|skirts?|shorts|leggings?)\b/i, "bottom"],
  [/\b(?:jackets?|coats?|blazers?|hoodies)\b/i, "outerwear"],
  [/\b(?:shirts?|t-?shirts?|tops?|kurtas?|blouses?|sweaters?)\b/i, "top"],
  [/\bbelts?\b/i, "belt"],
  [/\b(?:handbags?|shoulder bags?|backpacks?|purses?|clutches?)\b/i, "bag"],
];

export function classifyProductType(title: string, category: Product["category"]): ProductType {
  const matches = new Set<ProductType>();
  for (const [pattern, type] of rules) if (pattern.test(title)) matches.add(type);
  if (matches.size === 1) return [...matches][0];
  return matches.size === 0 && category === "makeup" ? "makeup" : "unknown";
}
