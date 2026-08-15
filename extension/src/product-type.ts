import type { Product, ProductType } from "./types";

const rules: Array<[RegExp, ProductType]> = [
  [/lipstick|foundation|concealer|blush|mascara|eyeliner|makeup/i, "makeup"],
  [/sunglass|eyeglass|spectacle|frame/i, "eyewear"],
  [/hat|cap|beanie|headband/i, "headwear"],
  [/earring|stud|hoop/i, "earrings"],
  [/necklace|pendant|chain/i, "necklace"],
  [/watch/i, "watch"],
  [/bracelet|bangle/i, "bracelet"],
  [/ring/i, "ring"],
  [/shoe|sneaker|sandal|heel|boot|slipper|loafer/i, "footwear"],
  [/dress|gown|saree|jumpsuit/i, "dress"],
  [/jean|trouser|pant|skirt|shorts|legging/i, "bottom"],
  [/jacket|coat|blazer|hoodie/i, "outerwear"],
  [/shirt|t-?shirt|top|kurta|blouse|sweater/i, "top"],
  [/belt/i, "belt"],
  [/handbag|shoulder bag|backpack|purse|clutch/i, "bag"],
];

export function classifyProductType(title: string, category: Product["category"]): ProductType {
  for (const [pattern, type] of rules) if (pattern.test(title)) return type;
  return category === "makeup" ? "makeup" : "unknown";
}
