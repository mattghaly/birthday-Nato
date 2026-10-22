import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { ensureTable, sql } from "@/lib/db";
import { ALLOWED_TYPES, MAX_CAPTION, MAX_FILE_BYTES } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTable();
    const rows = await sql()`SELECT id, url, caption FROM photos ORDER BY id DESC LIMIT 500`;
    return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not load photos" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("photo");
    const caption = String(form.get("caption") ?? "").trim();

    if (!(file instanceof File) || file.size === 0) return err("Please choose a photo.");
    if (!ALLOWED_TYPES.includes(file.type)) return err("Photo must be a JPG, PNG or WebP image.");
    if (file.size > MAX_FILE_BYTES) return err("That photo is too large (max 4 MB).");
    if (!caption) return err("Please write a caption.");
    if (caption.length > MAX_CAPTION) return err(`Caption must be ${MAX_CAPTION} characters or fewer.`);

    await ensureTable();
    const blob = await put(`photos/${Date.now()}.jpg`, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: true,
    });
    await sql()`INSERT INTO photos (url, caption) VALUES (${blob.url}, ${caption})`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return err("Upload failed on the server. Please try again.", 500);
  }
}

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
// Deliberately no DELETE handler: nobody can remove photos through the website.
