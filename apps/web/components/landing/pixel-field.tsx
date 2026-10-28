'use client';

import { useEffect, useRef } from 'react';

const PITCH = 8;
const DOT = 2.5;
const FPS = 30;
const POINTER_RADIUS = 160;

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const color = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

export function PixelField({ className = '' }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    let fg = color(el, '--fg');
    let accent = color(el, '--accent');
    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let phase = new Float32Array(0);
    const pointer = { x: -1e4, y: -1e4, strength: 0, target: 0 };
    let visible = true;
    let frame = 0;
    let last = 0;
    const started = performance.now();

    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / PITCH) + 1;
      rows = Math.ceil(height / PITCH) + 1;
      phase = new Float32Array(cols * rows);
      for (let i = 0; i < phase.length; i++) phase[i] = hash(i, 7) * Math.PI * 2;
    };

    const draw = (now: number) => {
      const t = still.matches ? 0 : (now - started) / 1000;
      pointer.strength += (pointer.target - pointer.strength) * 0.12;
      ctx.clearRect(0, 0, width, height);
      const offset = (PITCH - DOT) / 2;
      for (const pass of [0, 1] as const) {
        ctx.fillStyle = pass === 0 ? fg : accent;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const field = noise(x * 0.05 + t * 0.06, y * 0.05 - t * 0.04);
            const twinkle = 0.5 + 0.5 * Math.sin(t * 1.6 + phase[y * cols + x]!);
            const px = x * PITCH;
            const py = y * PITCH;
            const dx = px - pointer.x;
            const dy = py - pointer.y;
            const near =
              pointer.strength * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / POINTER_RADIUS);
            const hot = field > 0.72 || near > 0.35;
            if ((pass === 1) !== hot) continue;
            const alpha =
              pass === 0
                ? 0.05 + field * field * 0.16 * (0.6 + 0.4 * twinkle)
                : Math.min(0.85, (field - 0.6) * 1.6 * twinkle + near * 0.9);
            if (alpha < 0.02) continue;
            ctx.globalAlpha = alpha;
            ctx.fillRect(px + offset, py + offset, DOT, DOT);
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      if (now - last >= 1000 / FPS) {
        last = now;
        draw(now);
      }
      frame = visible && !still.matches ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (!frame && visible && !still.matches) frame = requestAnimationFrame(loop);
    };

    const host = el.parentElement ?? el;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.target = 1;
      if (still.matches) {
        pointer.strength = 1;
        draw(performance.now());
      }
    };
    const onLeave = () => {
      pointer.target = 0;
    };
    const onScheme = () => {
      fg = color(el, '--fg');
      accent = color(el, '--accent');
      draw(performance.now());
    };
    const onVisibility = () => {
      visible = !document.hidden;
      start();
    };

    resize();
    draw(started);
    start();

    const sizes = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    sizes.observe(el);
    const seen = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting && !document.hidden;
      start();
    });
    seen.observe(el);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    scheme.addEventListener('change', onScheme);
    still.addEventListener('change', start);

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      seen.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      scheme.removeEventListener('change', onScheme);
      still.removeEventListener('change', start);
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
