'use client';

import { useEffect } from 'react';

export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.lp');
    if (!root || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });

    root.classList.add('lp-motion-ready');
    const elements = root.querySelectorAll<HTMLElement>('[data-reveal]');
    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      root.classList.remove('lp-motion-ready');
    };
  }, []);

  return null;
}
