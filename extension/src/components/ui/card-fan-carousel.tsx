"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";

export interface CardItem {
  id: string;
  imgUrl: string;
  alt?: string;
}

type Props = { cards: CardItem[]; activeIndex: number; onSelect: (index: number) => void };
const MAX_VISIBLE = 7;
const HALF = 3;
const FAN_POSITIONS = [
  { rot: -21, scale: 0.7756, x: -30, y: 7.3, zIndex: 1 },
  { rot: -14, scale: 0.8498, x: -22, y: 4, zIndex: 2 },
  { rot: -7, scale: 0.9346, x: -11, y: 1.3, zIndex: 3 },
  { rot: 0, scale: 1, x: 0, y: 0, zIndex: 10 },
  { rot: 7, scale: 0.9346, x: 11, y: 1.3, zIndex: 3 },
  { rot: 14, scale: 0.8498, x: 22, y: 4, zIndex: 2 },
  { rot: 21, scale: 0.7756, x: 30, y: 7.3, zIndex: 1 },
];

function responsiveMultiplier(width: number) {
  if (width < 480) return 0.18;
  if (width < 640) return 0.3;
  if (width < 768) return 0.5;
  if (width < 1024) return 0.75;
  return 1;
}

function heightMultiplier(width: number) {
  const ideal = (width < 480 ? 22 : width < 640 ? 26 : width < 768 ? 28 : width < 1024 ? 34 : 38) * 16;
  return Math.min(1, window.innerHeight * 0.7 / ideal);
}

function slotConfig(total: number, slot: number) {
  if (total >= MAX_VISIBLE) return FAN_POSITIONS[slot];
  const center = total >> 1;
  const distance = total > 1 ? (slot - center) / center : 0;
  const absolute = Math.abs(distance);
  return {
    rot: distance * 21,
    scale: 1 - 0.2244 * absolute * absolute,
    x: distance * 30,
    y: absolute * absolute * 7.3,
    zIndex: 10 - Math.abs(slot - center),
  };
}

export default function CardFanCarousel({ cards, activeIndex, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animating = useRef(false);
  const entered = useRef(false);
  const direction = useRef<"left" | "right" | null>(null);
  const previousVisible = useRef<Set<number>>(new Set());
  const total = cards.length;
  const paginated = total > MAX_VISIBLE;
  const [centerIndex, setCenterIndex] = useState(paginated ? Math.max(HALF, activeIndex) : total >> 1);

  useEffect(() => {
    if (activeIndex >= 0 && paginated) setCenterIndex(activeIndex);
  }, [activeIndex, paginated]);

  const visibleMap = useCallback((center: number) => {
    const map = new Map<number, number>();
    if (!paginated) cards.forEach((_, index) => map.set(index, index));
    else for (let slot = 0; slot < MAX_VISIBLE; slot += 1) {
      map.set(((center + slot - HALF) % total + total) % total, slot);
    }
    return map;
  }, [cards, paginated, total]);

  const cycle = useCallback((nextDirection: "left" | "right") => {
    if (animating.current || !paginated) return;
    animating.current = true;
    direction.current = nextDirection;
    setCenterIndex((current) => nextDirection === "right" ? (current + 1) % total : (current - 1 + total) % total);
  }, [paginated, total]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !total) return;
    const elements = [...container.querySelectorAll<HTMLElement>(".fan-card")];
    const visible = visibleMap(centerIndex);
    const previous = previousVisible.current;
    const first = !entered.current;
    const multiplier = responsiveMultiplier(window.innerWidth);
    const vertical = heightMultiplier(window.innerWidth);
    const slots = paginated ? MAX_VISIBLE : total;
    const config = (slot: number) => slotConfig(slots, slot);
    if (first) animating.current = true;
    let completed = 0;
    const done = () => {
      completed += 1;
      if (completed >= visible.size) {
        animating.current = false;
        entered.current = true;
      }
    };

    elements.forEach((element, cardIndex) => {
      const slot = visible.get(cardIndex);
      const wasVisible = previous.has(cardIndex);
      if (slot !== undefined) {
        const position = config(slot);
        const target = {
          x: `${position.x * multiplier}rem`, y: `${position.y * vertical}rem`, rotation: position.rot,
          scale: position.scale, opacity: 1, zIndex: position.zIndex,
        };
        if (first) {
          gsap.set(element, { x: 0, y: `${12 * vertical}rem`, rotation: 0, scale: 0.5, opacity: 0 });
          gsap.to(element, { ...target, duration: 1.2, ease: "elastic.out(1.05,.78)", delay: 0.2 + slot * 0.06, onComplete: done });
        } else if (!wasVisible) {
          const enteringRight = direction.current === "right";
          gsap.set(element, { x: `${enteringRight ? 40 : -40}rem`, y: target.y, rotation: enteringRight ? 30 : -30, scale: 0.5, opacity: 0 });
          gsap.to(element, { ...target, duration: 0.6, ease: "power2.out", onComplete: done });
        } else gsap.to(element, { ...target, duration: 0.5, ease: "power2.out", onComplete: done });
      } else if (wasVisible) {
        const exitingLeft = direction.current === "right";
        gsap.to(element, { x: `${exitingLeft ? -40 : 40}rem`, opacity: 0, scale: 0.5, rotation: exitingLeft ? -30 : 30, duration: 0.4, ease: "power2.in", zIndex: 0 });
      } else if (first) gsap.set(element, { opacity: 0, scale: 0.3, x: 0, y: 0, zIndex: 0 });
    });
    previousVisible.current = new Set(visible.keys());

    const entries = elements.flatMap((element, index) => {
      const slot = visible.get(index);
      return slot === undefined ? [] : [{ element, slot }];
    }).sort((left, right) => left.slot - right.slot);
    let activeSlot: number | null = null;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const centerSlot = entries.length >> 1;
    const hover = (hovered: number | null) => {
      const horizontal = responsiveMultiplier(window.innerWidth);
      const height = heightMultiplier(window.innerWidth);
      entries.forEach(({ element, slot }) => {
        const base = config(slot);
        const distance = hovered === null ? 0 : Math.abs(slot - hovered);
        let x = base.x * horizontal;
        let y = base.y * height;
        let rotation = base.rot;
        let scale = base.scale;
        if (hovered !== null && slot === hovered) { y -= 2.5 * height; scale *= 1.08; }
        else if (hovered !== null) {
          const normalized = centerSlot ? (slot - centerSlot) / centerSlot : 0;
          const push = 8 * (1 - Math.abs(normalized)) * (1 + 0.2 * Math.max(0, 3 - distance));
          x += (slot < hovered ? -push : push) * horizontal;
          rotation += (slot < hovered ? -3 : 3) / (distance + 1);
        }
        gsap.to(element, { x: `${x}rem`, y: `${y}rem`, rotation, scale, duration: 0.5, delay: distance * 0.02, ease: "elastic.out(1,.75)", overwrite: "auto" });
        gsap.set(element, { zIndex: base.zIndex });
      });
    };
    const handlers = entries.map(({ element, slot }) => {
      const handler = () => {
        if (animating.current) return;
        if (leaveTimer) clearTimeout(leaveTimer);
        activeSlot = slot;
        hover(slot);
      };
      element.addEventListener("mouseenter", handler);
      return { element, handler };
    });
    const leave = () => {
      if (!animating.current) leaveTimer = setTimeout(() => { activeSlot = null; hover(null); }, 50);
    };
    const resize = () => { if (!animating.current) hover(activeSlot); };
    container.addEventListener("mouseleave", leave);
    window.addEventListener("resize", resize);
    return () => {
      handlers.forEach(({ element, handler }) => element.removeEventListener("mouseenter", handler));
      container.removeEventListener("mouseleave", leave);
      window.removeEventListener("resize", resize);
      if (leaveTimer) clearTimeout(leaveTimer);
      gsap.killTweensOf(elements);
    };
  }, [centerIndex, total, paginated, visibleMap]);

  if (!total) return null;
  const chevron = (left: boolean) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points={left ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} /></svg>;
  return <section className="card-fan-carousel" aria-label="Saved outfit comparison">
    <div ref={containerRef} className="fan-layout">{cards.map((card, index) => <button
      type="button" key={card.id} className="fan-card" aria-pressed={index === activeIndex}
      aria-label={`${card.alt ?? `Outfit ${index + 1}`}${index === activeIndex ? ", selected" : ""}`}
      onClick={() => onSelect(index)}
    ><img src={card.imgUrl} loading="lazy" alt={card.alt ?? `Outfit ${index + 1}`} /></button>)}</div>
    {paginated && <div className="fan-controls">
      <button type="button" className="fan-arrow" onClick={() => cycle("left")} aria-label="Previous outfit">{chevron(true)}</button>
      <span className="fan-count">{centerIndex + 1} / {total}</span>
      <button type="button" className="fan-arrow" onClick={() => cycle("right")} aria-label="Next outfit">{chevron(false)}</button>
    </div>}
  </section>;
}
