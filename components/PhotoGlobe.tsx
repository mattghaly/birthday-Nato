"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export type GlobePhoto = { id: number; url: string; caption: string };

// How many tiles sit on the sphere. Extra photos rotate in on the hidden back side,
// so the page stays fast with hundreds of photos.
const SLOTS = 56;
const CAMERA = 3.2; // perspective strength (smaller = stronger)
const BASE_SHADOW = "0 0 0 0px rgba(245,158,11,0), 0 4px 14px rgba(0,0,0,.3)";
const GLOW_SHADOW = "0 0 0 8px rgba(245,158,11,1), 0 4px 40px rgba(245,158,11,.9)";

// Evenly spread points on a unit sphere (Fibonacci lattice).
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const POINTS = Array.from({ length: SLOTS }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / SLOTS;
  const r = Math.sqrt(1 - y * y);
  const a = i * GOLDEN;
  return [Math.cos(a) * r, y, Math.sin(a) * r] as const;
});

// ---- tiny 3x3 rotation-matrix helpers (row-major) ----
type M = number[];
const identity = (): M => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (a: M, b: M): M => {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const rotY = (t: number): M => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotX = (t: number): M => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
// Keeps the matrix a pure rotation after hours of tiny float errors.
const clean = (m: M): M => {
  const n = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const r0 = n([m[0], m[1], m[2]]);
  const d = m[3] * r0[0] + m[4] * r0[1] + m[5] * r0[2];
  const r1 = n([m[3] - d * r0[0], m[4] - d * r0[1], m[5] - d * r0[2]]);
  const r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
  return [...r0, ...r1, ...r2];
};

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function PhotoGlobe({ photos }: { photos: GlobePhoto[] }) {
  const [tiles, setTiles] = useState<(GlobePhoto | null)[]>(() => Array(SLOTS).fill(null));
  const [size, setSize] = useState({ w: 0, h: 0 });

  const box = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const inner = useRef<(HTMLElement | null)[]>([]);

  const tilesRef = useRef<(GlobePhoto | null)[]>(Array(SLOTS).fill(null));
  const photosRef = useRef<GlobePhoto[]>([]);
  const known = useRef<Set<number>>(new Set());
  const zs = useRef<number[]>(Array(SLOTS).fill(0));
  const freshSlots = useRef<number[]>([]);
  const intro = useRef(false);

  const rot = useRef<M>(identity());
  const pending = useRef({ yaw: 0, pitch: 0 }); // rotation still "owed" to the globe: it follows softly
  const auto = useRef({ k: 1 }); // 0 = paused, 1 = idle spin
  const focus = useRef<{ slot: number; until: number } | null>(null);
  const drag = useRef({ active: false, x: 0, y: 0, dx: 0, dy: 0, t: 0 });
  const layout = useRef({ R: 200 });

  const R = Math.min(size.w, size.h) * 0.5 * 0.74;
  const tileW = Math.max(40, Math.sqrt((4 * Math.PI * R * R) / SLOTS) * 0.84);
  layout.current.R = R;

  const commit = (next: (GlobePhoto | null)[]) => { tilesRef.current = next; setTiles(next); };

  // Measure the area the globe lives in.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Put photos on the sphere; brand-new photos replace the tile facing you and the globe turns to show it.
  useEffect(() => {
    photosRef.current = photos;
    if (!photos.length) return;
    const prev = tilesRef.current;
    if (prev.every((t) => t === null)) {
      photos.forEach((p) => known.current.add(p.id));
      intro.current = true;
      commit(Array.from({ length: SLOTS }, (_, i) => photos[i % photos.length]));
      return;
    }
    const fresh = photos.filter((p) => !known.current.has(p.id)).reverse();
    if (!fresh.length) return;
    const next = [...prev];
    const taken = new Set<number>();
    fresh.forEach((p) => {
      known.current.add(p.id);
      let best = -1, bz = -9;
      for (let i = 0; i < SLOTS; i++) if (!taken.has(i) && zs.current[i] > bz) { bz = zs.current[i]; best = i; }
      if (best < 0) return;
      next[best] = p; taken.add(best); freshSlots.current.push(best);
    });
    commit(next);
  }, [photos]);

  // Animations that need the new tiles to exist in the DOM.
  useEffect(() => {
    if (intro.current) {
      intro.current = false;
      const all = inner.current.filter(Boolean) as HTMLElement[];
      if (!reduced()) gsap.from(all, { scale: 0, opacity: 0, duration: 0.9, ease: "back.out(1.6)", stagger: { each: 0.018, from: "random" } });
    }
    if (freshSlots.current.length) {
      const slots = freshSlots.current.splice(0);
      slots.forEach((slot) => {
        const el = inner.current[slot];
        if (!el || reduced()) return;
        gsap.timeline()
          .fromTo(el, { scale: 0.1, rotation: -30, boxShadow: GLOW_SHADOW }, { scale: 1.35, rotation: 0, boxShadow: GLOW_SHADOW, duration: 1.2, ease: "elastic.out(1, 0.6)" })
          .to(el, { scale: 1, boxShadow: BASE_SHADOW, duration: 0.9, ease: "power2.inOut" }, "+=2.6");
      });
      focus.current = { slot: slots[slots.length - 1], until: performance.now() + 3500 };
      pauseAuto(5);
    }
  }, [tiles]);

  // With more photos than tiles, swap photos in on the back of the globe where nobody sees the change.
  useEffect(() => {
    const id = setInterval(() => {
      const ps = photosRef.current;
      if (ps.length <= SLOTS) return;
      const shown = new Set(tilesRef.current.map((t) => t?.id));
      const pool = ps.filter((p) => !shown.has(p.id));
      if (!pool.length) return;
      let slot = -1, lo = -0.35;
      for (let i = 0; i < SLOTS; i++) if (zs.current[i] < lo) { lo = zs.current[i]; slot = i; }
      if (slot < 0) return;
      const next = [...tilesRef.current];
      next[slot] = pool[Math.floor(Math.random() * pool.length)];
      commit(next);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  function pauseAuto(delay: number) {
    gsap.to(auto.current, { k: 0, duration: 0.35, overwrite: true });
    gsap.to(auto.current, { k: 1, duration: 2.5, delay, ease: "power1.inOut" });
  }

  // The animation loop: soft-follow rotation + float + projection of every tile.
  useEffect(() => {
    const tick = (t: number, deltaMs: number) => {
      const dt = Math.min(0.05, deltaMs / 1000);
      const p = pending.current;

      // Closed loop "turn to this photo": always measures what is still missing.
      const fo = focus.current;
      if (fo) {
        const m = rot.current, q = POINTS[fo.slot];
        const x = m[0] * q[0] + m[1] * q[1] + m[2] * q[2];
        const y = m[3] * q[0] + m[4] * q[1] + m[5] * q[2];
        const z = m[6] * q[0] + m[7] * q[1] + m[8] * q[2];
        p.yaw = Math.atan2(-x, z);
        p.pitch = Math.atan2(y, Math.hypot(x, z));
        if (Math.abs(p.yaw) + Math.abs(p.pitch) < 0.015 || performance.now() > fo.until) focus.current = null;
      }

      const f = 1 - Math.exp(-dt * 6);
      const dy = p.yaw * f, dp = p.pitch * f;
      p.yaw -= dy; p.pitch -= dp;
      const spin = reduced() ? 0 : auto.current.k * 0.16 * dt;
      rot.current = mul(mul(rotX(dp), rotY(dy + spin)), rot.current);
      if (Math.round(t * 60) % 600 === 0) rot.current = clean(rot.current);

      const m = rot.current;
      const Rr = layout.current.R * (1 + Math.sin(t * 0.8) * 0.012);
      for (let i = 0; i < SLOTS; i++) {
        const el = els.current[i];
        const q = POINTS[i];
        const x = m[0] * q[0] + m[1] * q[1] + m[2] * q[2];
        const y = m[3] * q[0] + m[4] * q[1] + m[5] * q[2];
        const z = m[6] * q[0] + m[7] * q[1] + m[8] * q[2];
        zs.current[i] = z;
        if (!el) continue;
        const persp = CAMERA / (CAMERA - z);
        const bob = reduced() ? 0 : Math.sin(t * 0.9 + i * 1.7) * 5;
        const sway = reduced() ? 0 : Math.sin(t * 0.6 + i * 2.3) * 3;
        const vis = Math.min(1, Math.max(0, (z + 0.85) / 1.1));
        el.style.transform = `translate3d(${(x * Rr * persp).toFixed(2)}px,${(y * Rr * persp + bob).toFixed(2)}px,0) rotate(${sway.toFixed(2)}deg) scale(${persp.toFixed(3)})`;
        el.style.opacity = String(0.25 + 0.75 * vis);
        el.style.zIndex = String(Math.round((z + 1) * 500));
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  // Wheel input (needs a non-passive listener so the page does not scroll).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      focus.current = null;
      const c = (v: number) => Math.max(-2.5, Math.min(2.5, v));
      pending.current.yaw = c(pending.current.yaw + e.deltaY * 0.0035);
      pending.current.pitch = c(pending.current.pitch - e.deltaX * 0.0035);
      pauseAuto(2.5);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag input.
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { active: true, x: e.clientX, y: e.clientY, dx: 0, dy: 0, t: performance.now() };
    focus.current = null;
    gsap.to(auto.current, { k: 0, duration: 0.35, overwrite: true });
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY; d.dx = dx; d.dy = dy; d.t = performance.now();
    pending.current.yaw += dx / layout.current.R;
    pending.current.pitch -= dy / layout.current.R;
  };
  const up = () => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    if (performance.now() - d.t < 90) { // a flick keeps coasting
      pending.current.yaw += (d.dx / layout.current.R) * 6;
      pending.current.pitch -= (d.dy / layout.current.R) * 6;
    }
    gsap.to(auto.current, { k: 1, duration: 2.5, delay: 2, ease: "power1.inOut", overwrite: true });
  };

  return (
    <div ref={box} className="relative h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {tiles.map((p, i) =>
        p ? (
          <div key={i} ref={(el) => { els.current[i] = el; }}
            className="pointer-events-none absolute left-1/2 top-1/2 will-change-transform"
            style={{ width: tileW, marginLeft: -tileW / 2, marginTop: -tileW * 0.58, opacity: 0 }}>
            <figure ref={(el) => { inner.current[i] = el; }} className="m-0 bg-white"
              style={{ padding: `${tileW * 0.05}px ${tileW * 0.05}px 0`, border: "1px solid #d4d4d4", boxShadow: BASE_SHADOW }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption} draggable={false} decoding="async"
                style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
              <figcaption className="flex items-center justify-center overflow-hidden text-center font-bold"
                style={{ height: tileW * 0.2, fontSize: tileW * 0.085, lineHeight: 1.05 }}>
                <span className="line-clamp-2 px-0.5">{p.caption}</span>
              </figcaption>
            </figure>
          </div>
        ) : null
      )}
    </div>
  );
}
