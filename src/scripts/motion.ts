// Scroll reveals and header state.
// Elements already on screen at load are marked visible immediately (no flash);
// only elements below the fold are hidden and then revealed as they scroll in.

const REVEAL = [
  '.section-head', '.feature', '.card', '.topic', '.road-wrap', '.system li', '.sequence',
  '.split > *', '.stage', '.rollout', '.chips', '.lane', '.tier', '.cta-band .wrap > *',
  '.form', '.details', '.vision-notice', '.contact-grid > div > h2', '.contact-grid > div > p',
].join(',');

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const els = Array.from(document.querySelectorAll<HTMLElement>(REVEAL));

if (reduce || !('IntersectionObserver' in window)) {
  els.forEach((el) => el.classList.add('is-in'));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const el = e.target as HTMLElement;
          el.classList.add('is-in');
          io.unobserve(el);
          // hand control back to the element's own hover transitions once revealed
          setTimeout(() => el.removeAttribute('data-reveal'), 1600);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );

  for (const el of els) {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      el.classList.add('is-in');
      continue;
    }
    // stagger siblings that reveal together
    const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.matches(REVEAL)) : [];
    const idx = Math.max(0, siblings.indexOf(el));
    el.style.setProperty('--rd', `${Math.min(idx, 6) * 0.09}s`);
    el.setAttribute('data-reveal', '');
    io.observe(el);
  }
}

// Compact header after scrolling
const header = document.querySelector('.site-header');
const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 12);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();
