// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CardFanCarousel from "./card-fan-carousel";

vi.mock("gsap", () => ({ default: {
  set: vi.fn(),
  to: vi.fn((_target, options) => { options.onComplete?.(); }),
  killTweensOf: vi.fn(),
} }));

const cards = Array.from({ length: 8 }, (_, index) => ({ id: `outfit-${index}`, imgUrl: `data:image/jpeg;base64,${index}`, alt: `Outfit ${index}` }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("renders saved outfits as selectable cards with carousel controls", async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onSelect = vi.fn();
  await act(async () => root.render(<CardFanCarousel cards={cards} activeIndex={1} onSelect={onSelect} />));

  expect(host.querySelectorAll(".fan-card")).toHaveLength(8);
  expect(host.querySelectorAll('button[aria-label="Previous outfit"]')).toHaveLength(1);
  expect(host.querySelectorAll('button[aria-label="Next outfit"]')).toHaveLength(1);
  expect(host.querySelector('[aria-pressed="true"] img')?.getAttribute("alt")).toBe("Outfit 1");
  expect(host.querySelectorAll('.fan-card[aria-hidden="true"][tabindex="-1"]')).toHaveLength(1);

  await act(async () => (host.querySelectorAll(".fan-card")[3] as HTMLButtonElement).click());
  expect(onSelect).toHaveBeenCalledWith(3);
});
