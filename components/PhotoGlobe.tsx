"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

export type GlobePhoto = { id: number; url: string; caption: string };

// Maximum tiles on the sphere. With more photos than this, extra photos swap in
// on the hidden back side, so the page stays fast with hundreds of photos.
const SLOTS = 56;
const CAMERA = 3.2; // perspective strength (smaller = stronger)
const RASTER = 1.5; // tiles are drawn this much bigger than needed and scaled down, so they stay sharp up close
const RECENT_MS = 10000; // a just-added photo is never replaced for this long
const BASE_SHADOW = "0 0 0 0px rgba(245,158,11,0), 0 4px 14px rgba(0,0,0,.3)";
const GLOW_SHADOW = "0 0 0 8px rgba(245,158,11,1), 0 4px 40px rgba(245,158,11,.9)";
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// Look of the globe while there are few photos:
//   false (option A) = one tile per photo; the sphere grows as guests post.
//   true  (option B) = the sphere is always full: real photos are spread around and repeated to fill the gaps.
// You can compare both on the same site: open  /  for the default and  /?fill=1  or  /?fill=0  to force one.
const DEFAULT_FILL = false;

// Order in which real photos claim tiles in option B. Ranking a golden-ratio sequence
// spreads the first few photos evenly over the whole sphere instead of bunching them in one spot.
const SPREAD = (() => {
  const v = Array.from({ length: SLOTS }, (_, k) => (k * 0.6180339887) % 1);
  const sorted = [...v].sort((a, b) => a - b);
  return v.map((x) => sorted.indexOf(x));
})();

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
  // One tile per photo (up to SLOTS). The array grows as guests post.
  const [tiles, setTiles] = useState<GlobePhoto[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const box = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const inner = useRef<(HTMLElement | null)[]>([]);

  const tilesRef = useRef<GlobePhoto[]>([]);
  const photosRef = useRef<GlobePhoto[]>([]);
  const known = useRef<Set<number>>(new Set());
  const zs = useRef<number[]>(Array(SLOTS).fill(0));
  const addedAt = useRef<number[]>(Array(SLOTS).fill(0));
  const freshSlots = useRef<number[]>([]);
  const intro = useRef(false);
  const fill = useRef(DEFAULT_FILL); // option A / B
  const realCount = useRef(0); // option B: how many different photos already have their own tile
  const introSlot = useRef(0);

  // Where each tile sits on the unit sphere now (cur) and where it is heading (tgt).
  // When a photo is added every tile glides to its new spot, so the sphere re-spaces smoothly.
  const cur = useRef(new Float64Array(SLOTS * 3));
  const tgt = useRef(new Float64Array(SLOTS * 3));
  const count = useRef(0);
  const tileNow = useRef(0);
  const fullK = useRef(0); // 0 -> 1 once the sphere holds all SLOTS photos: then it also tumbles so every side is shown

  const rot = useRef<M>(identity());
  const pending = useRef({ yaw: 0, pitch: 0 }); // rotation still "owed" to the globe: it follows softly
  const auto = useRef({ k: 1 }); // 0 = paused, 1 = idle spin
  const focus = useRef<{ slot: number; until: number } | null>(null);
  const drag = useRef({ active: false, x: 0, y: 0, dx: 0, dy: 0, t: 0 });

  const R = Math.min(size.w, size.h) * 0.5 * 0.74;
  const domW = Math.max(60, R * 0.62 * RASTER);
  const layout = useRef({ R: 200, domW: 200 });
  layout.current.R = R;
  layout.current.domW = domW;

  const commit = (next: GlobePhoto[]) => { tilesRef.current = next; setTiles(next); };

  // Spread n points evenly over the sphere (Fibonacci lattice). New tiles start at their final spot.
  const layoutTo = (n: number) => {
    const old = count.current;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * GOLDEN;
      tgt.current[i * 3] = Math.cos(a) * r;
      tgt.current[i * 3 + 1] = y;
      tgt.current[i * 3 + 2] = Math.sin(a) * r;
      if (i >= old) {
        cur.current[i * 3] = tgt.current[i * 3];
        cur.current[i * 3 + 1] = tgt.current[i * 3 + 1];
        cur.current[i * 3 + 2] = tgt.current[i * 3 + 2];
      }
    }
    count.current = n;
  };

  // Pick option A or B from the address (?fill=1 / ?fill=0), otherwise the default above.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("fill");
    if (q === "1") fill.current = true;
    if (q === "0") fill.current = false;
  }, []);

  // Measure the area the globe lives in.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Photos -> tiles. Every new photo gets its OWN tile; once the sphere is full it replaces an older tile
  // (never one that was just added), and the globe turns to show it.
  useEffect(() => {
    photosRef.current = photos;
    if (!photos.length) return;
    const prev = tilesRef.current;
    const now = performance.now();

    if (prev.length === 0) {
      photos.forEach((p) => known.current.add(p.id));
      const first = photos.slice(0, SLOTS); // newest first
      intro.current = true;
      if (fill.current) {
        // Option B: the sphere is full from the start. Real photos are spread around, repeats fill the rest.
        const tilesB: GlobePhoto[] = new Array(SLOTS);
        for (let k = 0; k < first.length; k++) tilesB[SPREAD[k]] = first[k];
        let j = 0;
        for (let s = 0; s < SLOTS; s++) if (!tilesB[s]) tilesB[s] = first[j++ % first.length];
        realCount.current = first.length;
        introSlot.current = SPREAD[0];
        layoutTo(SLOTS);
        commit(tilesB);
      } else {
        introSlot.current = 0;
        layoutTo(first.length);
        commit(first);
      }
      return;
    }

    const fresh = photos.filter((p) => !known.current.has(p.id)).reverse(); // oldest first
    if (!fresh.length) return;
    const next = [...prev];
    fresh.forEach((p) => {
      let slot = -1;
      if (fill.current && realCount.current < SLOTS) {
        // Option B: the new photo takes over one repeated tile; no other photo is touched.
        slot = SPREAD[realCount.current++];
        next[slot] = p;
      } else if (!fill.current && next.length < SLOTS) {
        slot = next.length;
        next.push(p);
        layoutTo(next.length);
      } else {
        let bz = -9;
        for (let i = 0; i < SLOTS; i++)
          if (now - addedAt.current[i] > RECENT_MS && zs.current[i] > bz) { bz = zs.current[i]; slot = i; }
        if (slot < 0) return; // everything is brand new: this photo waits for the back-swap below
        next[slot] = p;
      }
      known.current.add(p.id);
      addedAt.current[slot] = now;
      freshSlots.current.push(slot);
    });
    commit(next);
  }, [photos]);

  // Animations that need the new tiles to exist in the DOM.
  useEffect(() => {
    if (intro.current) {
      intro.current = false;
      const all = inner.current.filter(Boolean) as HTMLElement[];
      if (!reduced()) gsap.from(all, { scale: 0, opacity: 0, duration: 0.9, ease: "back.out(1.6)", stagger: { each: 0.03, from: "random" } });
      focus.current = { slot: introSlot.current, until: performance.now() + 3500 };
    }
    if (freshSlots.current.length) {
      const slots = freshSlots.current.splice(0);
      slots.forEach((slot) => {
        const el = inner.current[slot];
        if (!el || reduced()) return;
        gsap.killTweensOf(el);
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
      if (tilesRef.current.length < SLOTS || ps.length <= SLOTS) return;
      const shown = new Set(tilesRef.current.map((t) => t.id));
      const pool = ps.filter((p) => !shown.has(p.id));
      if (!pool.length) return;
      const now = performance.now();
      let slot = -1, lo = -0.35;
      for (let i = 0; i < SLOTS; i++)
        if (now - addedAt.current[i] > RECENT_MS && zs.current[i] < lo) { lo = zs.current[i]; slot = i; }
      if (slot < 0) return;
      const next = [...tilesRef.current];
      next[slot] = pool[Math.floor(Math.random() * pool.length)];
      known.current.add(next[slot].id);
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
      const L = layout.current;
      const n = count.current;
      const c = cur.current, g = tgt.current;

      // Tiles glide toward their (re-spaced) positions.
      const glide = 1 - Math.exp(-dt * 2.5);
      for (let i = 0; i < n; i++) {
        const x = c[i * 3] + (g[i * 3] - c[i * 3]) * glide;
        const y = c[i * 3 + 1] + (g[i * 3 + 1] - c[i * 3 + 1]) * glide;
        const z = c[i * 3 + 2] + (g[i * 3 + 2] - c[i * 3 + 2]) * glide;
        const l = Math.hypot(x, y, z) || 1;
        c[i * 3] = x / l; c[i * 3 + 1] = y / l; c[i * 3 + 2] = z / l;
      }

      // Tile size: big when there are few photos, smaller as the sphere fills up.
      const want = Math.min(L.R * 0.62, Math.sqrt((4 * Math.PI * L.R * L.R) / Math.max(n, 12)) * 0.84);
      tileNow.current = tileNow.current === 0 ? want : tileNow.current + (want - tileNow.current) * (1 - Math.exp(-dt * 3));
      const mult = tileNow.current / L.domW;

      // Closed loop "turn to this photo": always measures what is still missing.
      const fo = focus.current;
      if (fo && fo.slot < n) {
        const m = rot.current;
        const qx = c[fo.slot * 3], qy = c[fo.slot * 3 + 1], qz = c[fo.slot * 3 + 2];
        const x = m[0] * qx + m[1] * qy + m[2] * qz;
        const y = m[3] * qx + m[4] * qy + m[5] * qz;
        const z = m[6] * qx + m[7] * qy + m[8] * qz;
        p.yaw = Math.atan2(-x, z);
        p.pitch = Math.atan2(y, Math.hypot(x, z));
        if (Math.abs(p.yaw) + Math.abs(p.pitch) < 0.015 || performance.now() > fo.until) focus.current = null;
      } else if (fo) focus.current = null;

      const f = 1 - Math.exp(-dt * 6);
      const dy = p.yaw * f, dp = p.pitch * f;
      p.yaw -= dy; p.pitch -= dp;
      fullK.current += ((n >= SLOTS ? 1 : 0) - fullK.current) * (1 - Math.exp(-dt * 0.8));
      const a = reduced() ? 0 : auto.current.k * dt;
      const spin = a * (0.16 + 0.07 * fullK.current); // turns a little faster when full
      const tumble = a * fullK.current * 0.12 * Math.sin(t * 0.12); // slowly tips the poles toward you
      rot.current = mul(mul(rotX(dp + tumble), rotY(dy + spin)), rot.current);
      if (Math.round(t * 60) % 600 === 0) rot.current = clean(rot.current);

      const m = rot.current;
      const Rr = L.R * (1 + Math.sin(t * 0.8) * 0.012);
      for (let i = 0; i < n; i++) {
        const qx = c[i * 3], qy = c[i * 3 + 1], qz = c[i * 3 + 2];
        const x = m[0] * qx + m[1] * qy + m[2] * qz;
        const y = m[3] * qx + m[4] * qy + m[5] * qz;
        const z = m[6] * qx + m[7] * qy + m[8] * qz;
        zs.current[i] = z;
        const el = els.current[i];
        if (!el) continue;
        const persp = CAMERA / (CAMERA - z);
        const bob = reduced() ? 0 : Math.sin(t * 0.9 + i * 1.7) * 5;
        const sway = reduced() ? 0 : Math.sin(t * 0.6 + i * 2.3) * 3;
        const vis = Math.min(1, Math.max(0, (z + 0.85) / 1.1));
        el.style.transform = `translate3d(${(x * Rr * persp).toFixed(2)}px,${(y * Rr * persp + bob).toFixed(2)}px,0) rotate(${sway.toFixed(2)}deg) scale(${(persp * mult).toFixed(4)})`;
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
      const cl = (v: number) => Math.max(-2.5, Math.min(2.5, v));
      pending.current.yaw = cl(pending.current.yaw + e.deltaY * 0.0035);
      pending.current.pitch = cl(pending.current.pitch - e.deltaX * 0.0035);
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
      {tiles.map((p, i) => (
        <div key={i} ref={(el) => { els.current[i] = el; }}
          className="pointer-events-none absolute left-1/2 top-1/2 will-change-transform"
          style={{ width: domW, marginLeft: -domW / 2, marginTop: -domW * 0.58, opacity: 0 }}>
          <figure ref={(el) => { inner.current[i] = el; }} className="m-0 bg-white"
            style={{ padding: `${domW * 0.05}px ${domW * 0.05}px 0`, border: "1px solid #d4d4d4", boxShadow: BASE_SHADOW }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.caption} draggable={false} decoding="async"
              style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
            <figcaption className="flex items-center justify-center overflow-hidden text-center font-bold"
              style={{ height: domW * 0.2, fontSize: domW * 0.085, lineHeight: 1.05 }}>
              <span className="line-clamp-2 px-0.5">{p.caption}</span>
            </figcaption>
          </figure>
        </div>
      ))}
    </div>
  );
}
