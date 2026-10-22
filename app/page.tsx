
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AGE, FEATURED_PHOTO, MESSAGE, NAME } from "@/lib/config";

type Photo = {
  id: number;
  url: string;
  caption: string;
};

type Placed = {
  photo: Photo;
  x: number;
  y: number;
  w: number;
  rot: number;
  z: number;
  ratio: number;
};

const POLL_MS = 5000;
const PAGE_MS = 9000;
const PER_PAGE = 8;

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cardHeightPerWidth = (ratio: number) => 0.9 / ratio + 0.25;

// Creates a layered Polaroid collage with intentional overlapping.
function scatter(
  photos: Photo[],
  ratios: Record<number, number>,
  W: number,
  H: number
): Placed[] {
  const list = photos.filter((p) => ratios[p.id] !== undefined);

  if (!list.length || W < 50 || H < 50) return [];

  const seed = list.reduce(
    (value, photo) => Math.imul(value ^ photo.id, 16777619) >>> 0,
    2166136261
  );

  const random = rng(seed);
  const n = list.length;

  // Keep the layout stable while the same photos remain on screen.
  return list.map((photo, index) => {
    const r = rng(photo.id);
    const ratio = ratios[photo.id];
    const cardHeight = cardHeightPerWidth(ratio);

    // Vary card sizes while leaving room for the caption.
    const maxW = Math.min(W * 0.36, H * 0.50 / cardHeight);
    const minW = Math.min(maxW, W * 0.24);
    const w = minW + r() * (maxW - minW);
    const h = w * cardHeight;

    // Cluster photos toward the middle to create a pile.
    const centerX = W * 0.50;
    const centerY = H * 0.50;
    const spreadX = W * 0.37;
    const spreadY = H * 0.36;

    const x = Math.max(
      0,
      Math.min(
        W - w,
        centerX + (random() - 0.5) * spreadX * 2 - w / 2
      )
    );

    const y = Math.max(
      0,
      Math.min(
        H - h,
        centerY + (random() - 0.5) * spreadY * 2 - h / 2
      )
    );

    return {
      photo,
      x,
      y,
      w,
      rot: (r() - 0.5) * 12,
      z: index + 1,
      ratio,
    };
  });
}

function ScallopFrame({ src }: { src: string }) {
  const W = 600;
  const H = 800;
  const r = 20;

  const circles = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    const step = r * 1.55;
    const jig = (i: number) => Math.sin(i * 12.9898) * 1.5;

    for (let x = r, i = 0; x <= W - r + 1; x += step, i++) {
      out.push(
        { x, y: r + jig(i) },
        { x, y: H - r + jig(i + 7) }
      );
    }

    for (
      let y = r + step, i = 0;
      y <= H - r - step + 1;
      y += step, i++
    ) {
      out.push(
        { x: r + jig(i + 3), y },
        { x: W - r + jig(i + 5), y }
      );
    }

    return out;
  }, []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-auto" aria-hidden>
      <defs>
        <clipPath id="ph">
          <rect
            x={r + 14}
            y={r + 14}
            width={W - 2 * r - 28}
            height={H - 2 * r - 28}
          />
        </clipPath>
      </defs>

      {circles.map((c, i) => (
        <circle
          key={i}
          cx={c.x}
          cy={c.y}
          r={r}
          fill="#fff"
          stroke="#111"
          strokeWidth="3"
        />
      ))}

      <rect
        x={r - 2}
        y={r - 2}
        width={W - 2 * r + 4}
        height={H - 2 * r + 4}
        fill="#fff"
      />

      <image
        href={src}
        x={r + 14}
        y={r + 14}
        width={W - 2 * r - 28}
        height={H - 2 * r - 28}
        preserveAspectRatio="xMidYMid slice"
        clipPath="url(#ph)"
      />

      <rect
        x={r + 14}
        y={r + 14}
        width={W - 2 * r - 28}
        height={H - 2 * r - 28}
        fill="none"
        stroke="#111"
        strokeWidth="3"
      />
    </svg>
  );
}

export default function Dashboard() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [page, setPage] = useState(0);
  const [origin, setOrigin] = useState("");
  const [ratios, setRatios] = useState<Record<number, number>>({});
  const [area, setArea] = useState({ w: 0, h: 0 });

  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Load new photos from the API.
  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/photos", {
          cache: "no-store",
        });

        if (!res.ok) return;

        const data: Photo[] = await res.json();

        if (!alive) return;

        setPhotos((prev) => {
          if (data.length > prev.length) {
            setPage(0);
          }

          return data;
        });
      } catch {
        // Keep displaying the photos already loaded.
      }
    };

    load();

    const interval = setInterval(load, POLL_MS);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  // Read each image's dimensions to preserve its original proportions.
  useEffect(() => {
    photos.forEach((photo) => {
      if (ratios[photo.id] !== undefined) return;

      const img = new Image();

      const done = (ratio: number) => {
        setRatios((prev) =>
          prev[photo.id] === undefined
            ? { ...prev, [photo.id]: ratio }
            : prev
        );
      };

      img.onload = () => {
        done(img.naturalWidth / img.naturalHeight || 1);
      };

      img.onerror = () => done(1);

      img.src = photo.url;
    });
  }, [photos, ratios]);

  // Measure the available collage area.
  useEffect(() => {
    const el = areaRef.current;

    if (!el) return;

    const observer = new ResizeObserver(() => {
      setArea({
        w: el.clientWidth,
        h: el.clientHeight,
      });
    });

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  const pages = Math.max(1, Math.ceil(photos.length / PER_PAGE));

  // Automatically rotate through pages when needed.
  useEffect(() => {
    if (pages < 2) return;

    const interval = setInterval(() => {
      setPage((current) => (current + 1) % pages);
    }, PAGE_MS);

    return () => clearInterval(interval);
  }, [pages]);

  const visible = photos.slice(
    (page % pages) * PER_PAGE,
    (page % pages) * PER_PAGE + PER_PAGE
  );

  const placed = useMemo(
    () => scatter(visible, ratios, area.w, area.h),
    [visible, ratios, area]
  );

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-white">
      <div className="absolute left-[3vw] top-[2vh] z-10 text-[11vh] font-bold leading-none">
        {NAME}
      </div>

      <div className="absolute left-[3vw] top-[15vh] h-[58vh]">
        <ScallopFrame src={FEATURED_PHOTO} />
      </div>

      <div className="absolute left-[4.5vw] top-[74.5vh] flex w-[43.5vh] items-baseline justify-end gap-[2vw] text-right">
        <span className="text-[12vh] leading-none">{MESSAGE}</span>
        <span className="text-[14vh] leading-none">{AGE}</span>
      </div>

      <section className="absolute right-0 top-0 h-[68vh] w-[68vw] p-[1.2vw]">
        {photos.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-center text-[6vh] text-neutral-500">
            Scan the code to add the first photo
          </p>
        )}

        <div ref={areaRef} className="relative h-full w-full">
          {placed.map((card) => (
            <figure
              key={card.photo.id}
              className="absolute bg-white shadow-[0_4px_14px_rgba(0,0,0,.3)] ring-1 ring-neutral-300"
              style={{
                left: card.x,
                top: card.y,
                width: card.w,
                padding: `${card.w * 0.05}px ${card.w * 0.05}px 0`,
                transform: `rotate(${card.rot}deg)`,
                zIndex: card.z,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={card.photo.url}
                alt={card.photo.caption}
                style={{
                  width: "100%",
                  aspectRatio: String(card.ratio),
                  objectFit: "contain",
                }}
                className="block"
              />

              <figcaption
                className="flex items-center justify-center overflow-hidden text-center font-bold"
                style={{
                  height: card.w * 0.2,
                  fontSize: card.w * 0.075,
                  lineHeight: 1.05,
                }}
              >
                <span className="line-clamp-2 px-1">
                  {card.photo.caption}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>

        {pages > 1 && (
          <div className="absolute bottom-[0.5vh] left-1/2 text-[2.4vh] text-neutral-400">
            {(page % pages) + 1} / {pages}
          </div>
        )}
      </section>

      {origin && (
        <div className="absolute bottom-[3vh] right-[2.5vw] z-10 flex flex-col items-center gap-[1vh]">
          <div className="bg-white p-[1.2vh]">
            <QRCodeSVG
              value={`${origin}/submit`}
              size={200}
              level="M"
              className="!h-[22vh] !w-[22vh]"
            />
          </div>

          <span className="text-[3.2vh] font-bold">
            Scan to add your photo
          </span>
        </div>
      )}
    </main>
  );
}
