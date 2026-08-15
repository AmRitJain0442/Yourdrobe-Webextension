export type Product = {
  id?: string;
  platform: "amazon_in" | "amazon_us" | "flipkart" | "nykaa";
  title: string;
  brand?: string;
  price?: number;
  currency?: "INR" | "USD";
  category: "apparel" | "makeup" | "other";
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
  mock?: boolean;
};

export type ExtractProductsResponse =
  | { ok: true; products: Product[] }
  | { ok: false; error: string };
