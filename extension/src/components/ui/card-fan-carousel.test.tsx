// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CardFanCarousel from "./card-fan-carousel";

const cards = Array.from({ length: 8 }, (_, index) => ({ id: `outfit-${index}`, imgUrl: `data:image/jpeg;base64,${index}`, alt: `Outfit ${index}` }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("shows one saved outfit at a time and switches it with arrows", async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onSelect = vi.fn();
  await act(async () => root.render(<CardFanCarousel cards={cards} activeIndex={1} onSelect={onSelect} />));

  expect(host.querySelectorAll(".outfit-slide")).toHaveLength(1);
  expect(host.querySelectorAll('button[aria-label="Previous outfit"]')).toHaveLength(1);
  expect(host.querySelectorAll('button[aria-label="Next outfit"]')).toHaveLength(1);
  expect(host.querySelector(".outfit-slide img")?.getAttribute("alt")).toBe("Outfit 1");
  expect(host.textContent).toContain("2 / 8");

  await act(async () => (host.querySelector('button[aria-label="Next outfit"]') as HTMLButtonElement).click());
  expect(onSelect).toHaveBeenCalledWith(2);
});
