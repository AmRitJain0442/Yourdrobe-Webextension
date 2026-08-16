import { afterEach, describe, expect, it } from "vitest";
import { selectAdapter } from ".";

afterEach(() => { document.body.innerHTML = ""; });

const cases = [
  {
    host: "www.amazon.in",
    html: `<div data-component-type="s-search-result" data-asin="HIDDEN-IN" hidden><h2><a href="/dp/HIDDEN-IN"><span>Hidden Shirt</span></a></h2><img class="s-image" src="https://img/hidden-in.jpg"><span class="a-price-whole">999</span></div><div data-component-type="s-search-result" data-asin="IN1"><h2><a href="/dp/IN1"><span>Red Shirt</span></a></h2><img class="s-image" src="https://img/in.jpg"><span class="a-price-whole">1,799</span></div>`,
    platform: "amazon_in", currency: "INR", price: 1799, category: "apparel", product_type: "top", url: "https://www.amazon.in/dp/IN1",
  },
  {
    host: "www.amazon.com",
    html: `<div data-component-type="s-search-result" data-asin="US1"><h2><a href="/dp/US1"><span>Blue Shirt</span></a></h2><img class="s-image" src="https://img/us.jpg"><span class="a-price-whole">29</span><span class="a-price-fraction">99</span></div>`,
    platform: "amazon_us", currency: "USD", price: 29.99, category: "apparel", product_type: "top", url: "https://www.amazon.com/dp/US1",
  },
  {
    host: "www.flipkart.com",
    html: `<div data-id="HIDDEN-FK" style="display: none"><a href="/hidden-shirt/p/HIDDEN-FK"><img src="https://img/hidden-fk.jpg" alt="Hidden Shirt"><div class="product-title">Hidden Shirt</div><div class="price">₹999</div></a></div><div data-id="FK1"><a href="/red-shirt/p/FK1"><img src="https://img/fk.jpg" alt="Red Shirt"><div class="product-title">Red Shirt</div><div class="price">₹1,499</div></a></div>`,
    platform: "flipkart", currency: "INR", price: 1499, category: "apparel", product_type: "top", url: "https://www.flipkart.com/red-shirt/p/FK1",
  },
  {
    host: "www.nykaa.com",
    html: `<div data-testid="product-card" aria-hidden="true"><a href="/hidden-lipstick/p/HIDDEN-NY"><img src="https://img/hidden-ny.jpg" alt="Hidden Lipstick"><div class="product-title">Hidden Lipstick</div><div class="price">₹999</div></a></div><div data-testid="product-card"><a href="/red-lipstick/p/NY1"><img src="https://img/ny.jpg" alt="Ruby Red Lipstick"><div class="product-title">Ruby Red Lipstick</div><div class="price">₹799</div><span class="shade">Ruby Red</span></a></div>`,
    platform: "nykaa", currency: "INR", price: 799, category: "makeup", product_type: "makeup", url: "https://www.nykaa.com/red-lipstick/p/NY1",
  },
] as const;

describe("commerce adapters", () => {
  for (const item of cases) {
    it(`extracts ${item.host}`, () => {
      document.body.innerHTML = item.html;
      const products = selectAdapter(item.host, document)?.extractProducts() ?? [];
      expect(products).toHaveLength(1);
      expect(products[0]).toMatchObject({ platform: item.platform, currency: item.currency, price: item.price, category: item.category, product_type: item.product_type, product_url: item.url });
      expect(products[0].title).toBeTruthy();
      expect(products[0].image_url).toMatch(/^https:/);
    });
  }

  for (const [label, href] of [
    ["foreign", "https://attacker.example/dp/BAD"],
    ["non-HTTPS", "http://www.amazon.in/dp/BAD"],
    ["malformed", "https://%"],
  ]) {
    it(`skips a ${label} product link without breaking extraction`, () => {
      document.body.innerHTML = `
        <div data-component-type="s-search-result"><h2><a href="${href}"><span>Bad Shirt</span></a></h2><img src="https://img/bad.jpg"></div>
        <div data-component-type="s-search-result"><h2><a href="/dp/GOOD"><span>Good Shirt</span></a></h2><img src="https://img/good.jpg"></div>`;
      const products = selectAdapter("www.amazon.in", document)?.extractProducts() ?? [];
      expect(products).toHaveLength(1);
      expect(products[0].product_url).toBe("https://www.amazon.in/dp/GOOD");
    });
  }

  it("extracts every visible product for side-panel pagination", () => {
    document.body.innerHTML = Array.from({ length: 30 }, (_, index) => `
      <div data-component-type="s-search-result"><h2><a href="/dp/${index}"><span>Shirt ${index}</span></a></h2><img src="https://img/${index}.jpg"></div>`).join("");
    const products = selectAdapter("www.amazon.in", document)?.extractProducts() ?? [];
    expect(products).toHaveLength(30);
    expect(products.at(-1)?.product_url).toBe("https://www.amazon.in/dp/29");
  });

  it("extracts Amazon's title-recipe card markup", () => {
    document.body.innerHTML = `
      <div data-component-type="s-search-result" data-asin="B0ABC12345">
        <a href="/sponsored-redirect"><h2 aria-label="Sponsored Ad - Linen Dress"><span>Linen Dress</span></h2></a>
        <img class="s-image" src="https://img/dress.jpg">
        <span class="a-price-whole">1,199</span>
      </div>`;
    const products = selectAdapter("www.amazon.in", document)?.extractProducts() ?? [];
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      title: "Linen Dress",
      product_type: "dress",
      product_url: "https://www.amazon.in/dp/B0ABC12345",
      price: 1199,
    });
  });

  it("classifies an accessory fixture", () => {
    document.body.innerHTML = `
      <div data-component-type="s-search-result" data-asin="B0WATCH123">
        <h2><a href="/watch"><span>Leather wrist watch</span></a></h2>
        <img class="s-image" src="https://img/watch.jpg">
      </div>`;
    const products = selectAdapter("www.amazon.in", document)?.extractProducts() ?? [];
    expect(products[0].product_type).toBe("watch");
  });
});
