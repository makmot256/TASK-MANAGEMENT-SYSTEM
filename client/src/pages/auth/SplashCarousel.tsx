import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

type Slide = {
  title: ReactNode;
  text: string;
  image: string;
};

const img = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1280&q=70`;

const SLIDES: Slide[] = [
  {
    title: (
      <>
        Assign work with <b>clarity</b>
      </>
    ),
    text: 'Create tasks, set deadlines, and keep every member aligned from one shared workspace.',
    image: img('photo-1522071820081-009f0129c71c'),
  },
  {
    title: (
      <>
        Review progress in <b>one place</b>
      </>
    ),
    text: 'Collect reports, leave feedback, and approve submissions without chasing updates across tools.',
    image: img('photo-1552664730-d307ca884978'),
  },
  {
    title: (
      <>
        Grow with <b>performance insight</b>
      </>
    ),
    text: 'Track quality, peer reviews, and engagement so supervisors can coach teams with confidence.',
    image: img('photo-1460925895917-afdab827c52f'),
  },
];

const AUTO_MS = 5000;

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function SplashCarousel({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const last = SLIDES.length - 1;
  const slide = SLIDES[index];

  useEffect(() => {
    SLIDES.forEach((s) => {
      const i = new Image();
      i.src = s.image;
    });
  }, []);

  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(SLIDES.length - 1, next)));
  }, []);

  useEffect(() => {
    if (paused || prefersReduced() || index >= last) return;
    const t = window.setTimeout(() => setIndex((i) => Math.min(last, i + 1)), AUTO_MS);
    return () => window.clearTimeout(t);
  }, [index, paused, last]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
    setPaused(true);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 45) {
      if (dx < 0) go(index + 1);
      else go(index - 1);
    }
    touchX.current = null;
    setPaused(false);
  };

  return (
    <div
      className="ob-splash ob-fade-in"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="group"
      aria-roledescription="carousel"
      aria-label="TASK MANAGEMENT SYSTEM highlights"
    >
      <div className="ob-splash-bgs" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <div
            key={i}
            className={`ob-slide-bg ${i === index ? 'active' : ''}`}
            style={{ backgroundImage: `url("${s.image}")` }}
          />
        ))}
        <div className="ob-slide-scrim" />
      </div>

      <div className="ob-splash-center">
        <div className="ob-slide-copy" key={index}>
          <h2 className="ob-slide-title">{slide.title}</h2>
          <p className="ob-slide-text">{slide.text}</p>
        </div>

        <div className="ob-dots" role="tablist" aria-label="Choose slide">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Go to slide ${i + 1}`}
              className={`ob-dot ${i === index ? 'active' : ''}`}
              onClick={() => go(i)}
            />
          ))}
        </div>

        <div className="ob-splash-actions">
          {index < last ? (
            <button type="button" className="ob-btn ob-btn-primary" onClick={() => go(index + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="ob-btn ob-btn-primary" onClick={onDone}>
              Get Started
            </button>
          )}
          <button type="button" className="ob-skip" onClick={onDone}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
