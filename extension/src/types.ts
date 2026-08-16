export type ProductType =
  | "makeup" | "eyewear" | "headwear" | "earrings" | "necklace"
  | "top" | "outerwear" | "dress" | "bottom" | "belt" | "bag"
  | "watch" | "bracelet" | "ring" | "footwear" | "unknown";

export type Product = {
  id?: string;
  platform: "amazon_in" | "amazon_us" | "flipkart" | "nykaa";
  title: string;
  brand?: string;
  price?: number;
  currency?: "INR" | "USD";
  category: "apparel" | "makeup" | "other";
  product_type?: ProductType;
  image_url: string;
  product_url: string;
  metadata: { shade?: string; color?: string };
};

export type TryOnJob = {
  job_id: string;
  product_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  result_url?: string;
  error_code?: string;
  error_message?: string;
  mock?: boolean;
};

export type ExtractProductsResponse =
  | { ok: true; products: Product[] }
  | { ok: false; error: string };

export type AddToCartResponse =
  | { ok: true }
  | { ok: false; error: string };
