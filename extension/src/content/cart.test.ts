import { describe, expect, it, vi } from "vitest";
import { addCurrentProductToCart } from "./cart";

describe("addCurrentProductToCart", () => {
  it.each([
    ["amazon.in", '<input id="add-to-cart-button" type="button">'],
    ["flipkart.com", "<button>Add to cart</button>"],
    ["nykaa.com", "<button>Add to Bag</button>"],
  ])("clicks the supported %s cart control", (hostname, markup) => {
    document.body.innerHTML = markup;
    const button = document.querySelector("button, input") as HTMLElement;
    const click = vi.spyOn(button, "click").mockImplementation(() => undefined);

    expect(addCurrentProductToCart(hostname, document)).toEqual({ ok: true });
    expect(click).toHaveBeenCalledOnce();
  });

  it("keeps the product page open when a size or other selection is required", () => {
    document.body.innerHTML = "<button>Choose size</button>";
    expect(addCurrentProductToCart("flipkart.com", document)).toEqual({
      ok: false,
      error: "Choose any required size or option, then add this product to the cart.",
    });
  });
});
