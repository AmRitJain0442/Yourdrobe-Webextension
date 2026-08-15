import type { Product } from "../../types";

export interface CommerceAdapter {
  extractProducts(): Product[];
}
