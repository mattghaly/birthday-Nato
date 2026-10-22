"use client";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ALLOWED_TYPES, MAX_CAPTION, NAME } from "@/lib/config";

// Shrinks the photo in the browser so uploads are fast and always under the size limit.
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("fail"))), "image/jpeg", 0.85));
}

// Tiny thumbnail used for the "your photos" stack, so memory stays flat even after many uploads.
async function thumb(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const small = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("fail"))), "image/jpeg", 0.7));
  return URL.createObjectURL(small);
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The stack only ever renders the latest few photos; the rest are summed into a counter.
// That keeps the DOM tiny and the animation smooth no matter how many photos a guest sends.
const STACK_MAX = 5;
const CONFETTI = 16;
const COLORS = ["#111111", "#f59e0b", "#ec4899", "#3b82f6", "#10b981"];

type Posted = { id: number; url: string };

export default function Submit() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [posted, setPosted] = useState<Posted[]>([]);
  const [total, setTotal] = useState(0);

  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const empty = useRef<HTMLDivElement>(null);
  const msgEl = useRef<HTMLParagraphElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const pool = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const seen = useRef<Set<number>>(new Set());
  const nextId = useRef(1);

  useEffect(() => {
    if (!file) return setPreview("");
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Free thumbnail URLs when the page closes.
  const postedRef = useRef<Posted[]>([]);
  postedRef.current = posted;
  useEffect(() => () => postedRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  // 1. Page entrance: everything marked .reveal rises in with a stagger.
  useEffect(() => {
    if (reduced()) return;
    const ctx = gsap.context(() => {
      gsap.from(".reveal", { y: 28, opacity: 0, duration: 0.7, stagger: 0.09, ease: "power3.out", clearProps: "all" });
    }, root);
    return () => ctx.revert();
  }, []);

  // 2. Empty frame breathes; a chosen photo drops in like a Polaroid being tossed on a table.
  useEffect(() => {
    if (reduced()) return;
    if (preview && card.current) {
      gsap.fromTo(
        card.current,
        { y: -90, rotation: gsap.utils.random(-12, 12), scale: 0.7, opacity: 0 },
        { y: 0, rotation: gsap.utils.random(-2.5, 2.5), scale: 1, opacity: 1, duration: 0.8, ease: "back.out(1.6)" }
      );
    } else if (empty.current) {
      const t = gsap.to(empty.current, { scale: 1.015, duration: 1.6, repeat: -1, yoyo: true, ease: "sine.inOut" });
      return () => { t.kill(); gsap.set(empty.current, { clearProps: "transform" }); };
    }
  }, [preview]);

  // 3. While uploading the Polaroid trembles gently.
  useEffect(() => {
    if (!busy || !card.current || reduced()) return;
    const t = gsap.to(card.current, { rotation: "+=1.6", y: -4, duration: 0.18, repeat: -1, yoyo: true, ease: "sine.inOut" });
    return () => { t.kill(); };
  }, [busy]);

  // 4. Status message pops in; errors shake.
  useEffect(() => {
    if (!msg || !msgEl.current || reduced()) return;
    if (msg.ok) gsap.fromTo(msgEl.current, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "elastic.out(1, 0.5)" });
    else gsap.fromTo(msgEl.current, { x: -12 }, { x: 0, duration: 0.6, ease: "elastic.out(1.2, 0.25)" });
  }, [msg]);

  // 5. Stack of photos this guest already sent: new ones land on top, old ones fan out.
  useEffect(() => {
    if (!stack.current) return;
    const els = gsap.utils.toArray<HTMLElement>("[data-thumb]", stack.current);
    els.forEach((el, i) => {
      const id = Number(el.dataset.thumb);
      const x = (i - (els.length - 1) / 2) * 34;
      const rot = ((id * 7) % 9) - 4;
      if (!seen.current.has(id)) {
        seen.current.add(id);
        if (reduced()) gsap.set(el, { x, rotation: rot, opacity: 1 });
        else gsap.fromTo(el, { y: -240, x, scale: 1.9, rotation: rot + 30, opacity: 0 }, { y: 0, scale: 1, rotation: rot, opacity: 1, duration: 0.9, ease: "back.out(1.3)" });
      } else {
        gsap.to(el, { x, rotation: rot, duration: 0.5, ease: "power3.out" });
      }
    });
  }, [posted]);

  // Counter bumps each time a photo is posted.
  useEffect(() => {
    if (!total || !counter.current || reduced()) return;
    gsap.fromTo(counter.current, { scale: 1.8 }, { scale: 1, duration: 0.6, ease: "back.out(3)" });
  }, [total]);

  function burst(from: DOMRect) {
    if (!pool.current || reduced()) return;
    const dots = gsap.utils.toArray<HTMLElement>(".dot", pool.current);
    gsap.set(dots, { x: from.left + from.width / 2, y: from.top + from.height / 3, scale: 0, opacity: 1 });
    dots.forEach((d) => {
      const a = gsap.utils.random(0, Math.PI * 2);
      const r = gsap.utils.random(70, 190);
      gsap.to(d, {
        x: `+=${Math.cos(a) * r}`,
        y: `+=${Math.sin(a) * r - 40}`,
        rotation: gsap.utils.random(-360, 360),
        scale: gsap.utils.random(0.7, 1.4),
        duration: 0.5,
        ease: "power2.out",
        onComplete: () => { gsap.to(d, { y: "+=90", opacity: 0, scale: 0, duration: 0.6, ease: "power1.in" }); },
      });
    });
  }

  // The photo "flies off to the big screen".
  async function flyAway() {
    const el = card.current;
    if (!el || reduced()) return;
    const rect = el.getBoundingClientRect();
    await gsap
      .timeline()
      .to(el, { scale: 1.06, rotation: 0, duration: 0.18, ease: "power2.out" })
      .add(() => burst(rect))
      .to(el, { y: -(rect.bottom + 80), rotation: gsap.utils.random(-18, 18), scale: 0.45, opacity: 0, duration: 0.7, ease: "power3.in" })
      .then();
  }

  function pick(f?: File) {
    setMsg(null);
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type)) return setMsg({ ok: false, text: "Please choose a JPG, PNG or WebP photo." });
    setFile(f);
  }

  async function post() {
    if (!file) return setMsg({ ok: false, text: "Choose or take a photo first." });
    if (!caption.trim()) return setMsg({ ok: false, text: "Write a caption first." });
    setBusy(true); setMsg(null);
    try {
      const blob = await shrink(file);
      const fd = new FormData();
      fd.append("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      fd.append("caption", caption.trim());
      const res = await fetch("/api/photos", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed. Please try again.");

      const url = await thumb(blob).catch(() => "");
      await flyAway();
      setMsg({ ok: true, text: "Posted! Look up at the screen." });
      setFile(null); setCaption("");
      setTotal((n) => n + 1);
      if (url) {
        const id = nextId.current++;
        setPosted((prev) => {
          const next = [...prev, { id, url }];
          next.splice(0, Math.max(0, next.length - STACK_MAX)).forEach((p) => URL.revokeObjectURL(p.url));
          return next;
        });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed. Please try again." });
    } finally { setBusy(false); }
  }

  // Springy press feedback for every button.
  const press = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { if (!reduced() && !e.currentTarget.disabled) gsap.to(e.currentTarget, { scale: 0.94, duration: 0.12, ease: "power2.out" }); },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => { gsap.to(e.currentTarget, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" }); },
    onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => { gsap.to(e.currentTarget, { scale: 1, duration: 0.3 }); },
  };

  const btn = "w-full rounded-xl border-2 border-black py-3 text-2xl font-bold active:bg-neutral-100";
  return (
    <main ref={root} className="mx-auto flex min-h-screen max-w-md flex-col gap-4 overflow-x-hidden p-5">
      <h1 className="reveal text-5xl font-bold">Add a photo for {NAME}</h1>

      <div className="reveal">
        {preview ? (
          <div ref={card} className="bg-white p-3 pb-0 shadow-md ring-1 ring-neutral-300 will-change-transform">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="block max-h-[60vh] w-full object-contain" />
            <div className="h-10" />
          </div>
        ) : (
          <div ref={empty} className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-neutral-400 text-2xl text-neutral-500">
            Your photo will show here
          </div>
        )}
      </div>

      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="reveal grid grid-cols-2 gap-3">
        <button className={btn} onClick={() => cam.current?.click()} {...press}>Take photo</button>
        <button className={btn} onClick={() => gal.current?.click()} {...press}>Choose photo</button>
      </div>

      <label className="reveal text-2xl font-bold" htmlFor="cap">Caption</label>
      <input id="cap" value={caption} maxLength={MAX_CAPTION} onChange={(e) => setCaption(e.target.value)}
        placeholder="Write something sweet"
        className="reveal rounded-xl border-2 border-black px-4 py-3 text-2xl outline-none focus:ring-2 focus:ring-black" />
      <div className="reveal -mt-3 text-right text-lg text-neutral-500">{caption.length}/{MAX_CAPTION}</div>

      <button disabled={busy || !file || !caption.trim()} onClick={post} {...press}
        className="reveal w-full rounded-xl bg-black py-4 text-3xl font-bold text-white disabled:opacity-40">
        {busy ? "Posting…" : "Post"}
      </button>

      {msg && <p ref={msgEl} role="status" className={`rounded-xl border-2 p-3 text-center text-2xl font-bold ${msg.ok ? "border-black" : "border-red-600 text-red-700"}`}>{msg.text}</p>}

      {total > 0 && (
        <section className="mt-2 flex flex-col items-center gap-3 pb-6">
          <div ref={stack} className="relative h-28 w-full">
            {posted.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} data-thumb={p.id} src={p.url} alt="" style={{ zIndex: i, opacity: 0 }}
                className="absolute left-1/2 top-0 -ml-10 h-24 w-20 bg-white object-cover p-1 pb-4 shadow-md ring-1 ring-neutral-300 will-change-transform" />
            ))}
          </div>
          <p className="text-2xl text-neutral-600">
            <span ref={counter} className="inline-block font-bold text-black">{total}</span> {total === 1 ? "photo" : "photos"} sent so far
          </p>
        </section>
      )}

      {/* Reusable confetti pool: always a fixed number of nodes, however many photos are sent. */}
      <div ref={pool} aria-hidden className="pointer-events-none fixed inset-0 z-50">
        {Array.from({ length: CONFETTI }, (_, i) => (
          <span key={i} className="dot absolute left-0 top-0 block h-3 w-2 rounded-[2px] opacity-0" style={{ background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
    </main>
  );
}
