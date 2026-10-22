"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AGE, FEATURED_PHOTO, MESSAGE, NAME } from "@/lib/config";
import PhotoGlobe, { type GlobePhoto } from "@/components/PhotoGlobe";

const POLL_MS = 5000;

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
  const [photos, setPhotos] = useState<GlobePhoto[]>([]);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Load new photos from the API.
  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/photos", { cache: "no-store" });
        if (!res.ok) return;
        const data: GlobePhoto[] = await res.json();
        if (!alive) return;
        // Only update when something actually changed, so the globe is not disturbed.
        setPhotos((prev) =>
          prev.length === data.length && prev[0]?.id === data[0]?.id ? prev : data
        );
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

        <PhotoGlobe photos={photos} />
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
