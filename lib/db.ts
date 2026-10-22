import { neon } from "@neondatabase/serverless";

// DATABASE_URL is added automatically when you connect Neon in Vercel.
export function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return neon(process.env.DATABASE_URL);
}

let ready = false;
export async function ensureTable() {
  if (ready) return;
  await sql()`CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    caption TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  ready = true;
}
