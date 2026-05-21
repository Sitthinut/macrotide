import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/api/with-db";
import { dropDemoSession, getOrCreateDemoSession } from "@/lib/db/demo";

const COOKIE_MAX_AGE = 60 * 60 * 24; // 24h; demo data is in-memory and TTL'd separately

/**
 * Start a new demo session. Creates an isolated in-memory SQLite seeded with
 * mock data and sets a cookie so subsequent requests route to it.
 */
export async function POST() {
  const id = randomUUID();
  // Materialize the session synchronously so the first page render after
  // setting the cookie finds an existing DB instead of racing the factory.
  getOrCreateDemoSession(id);
  const res = NextResponse.json({ ok: true, sessionId: id });
  res.cookies.set(DEMO_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

/**
 * End the active demo session — clears the cookie and drops the in-memory DB.
 * Idempotent.
 */
export async function DELETE(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${DEMO_COOKIE}=([^;]+)`));
  if (match) dropDemoSession(match[1]);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEMO_COOKIE);
  return res;
}
