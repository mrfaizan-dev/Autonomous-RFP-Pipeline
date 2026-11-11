'use client';

import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export default function ScrollMotion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((element) => {
        gsap.fromTo(
          element,
          { y: 28, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.76,
            ease: 'power2.out',
            scrollTrigger: { trigger: element, start: 'top 87%', once: true },
          },
        );
      });
      gsap.utils.toArray<HTMLElement>('[data-line-reveal]').forEach((element) => {
        gsap.fromTo(element, { scaleX: 0, transformOrigin: 'left center' }, {
          scaleX: 1,
          duration: 0.85,
          ease: 'power2.out',
          scrollTrigger: { trigger: element, start: 'top 88%', once: true },
        });
      });
    });
    return () => ctx.revert();
  }, []);

  return null;
}
