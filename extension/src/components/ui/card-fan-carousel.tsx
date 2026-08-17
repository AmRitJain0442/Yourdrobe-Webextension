"use client";

export interface CardItem {
  id: string;
  imgUrl: string;
  alt?: string;
}

type Props = { cards: CardItem[]; activeIndex: number; onSelect: (index: number) => void };

export default function CardFanCarousel({ cards, activeIndex, onSelect }: Props) {
  if (!cards.length) return null;
  const current = activeIndex >= 0 && activeIndex < cards.length ? activeIndex : 0;
  const card = cards[current] ?? cards[0];
  const previous = (current - 1 + cards.length) % cards.length;
  const next = (current + 1) % cards.length;

  return <section className="saved-outfit-carousel" aria-label="Saved outfit comparison">
    <div className="carousel-stage">
      <button type="button" className="carousel-arrow" disabled={cards.length < 2} onClick={() => onSelect(previous)} aria-label="Previous outfit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <figure className="outfit-slide" aria-live="polite">
        <img src={card.imgUrl} loading="lazy" alt={card.alt ?? `Outfit ${current + 1}`} />
        <figcaption>{current + 1} / {cards.length}</figcaption>
      </figure>
      <button type="button" className="carousel-arrow" disabled={cards.length < 2} onClick={() => onSelect(next)} aria-label="Next outfit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
    </div>
  </section>;
}
