import { NextResponse } from "next/server";
import { SNACK_KINDS, type SnackKind } from "./types";

export class BadRequest extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
/** Something is true about the world that makes the request impossible (409). */
export class Conflict extends BadRequest {
  constructor(message: string) {
    super(message, 409);
  }
}
export class NotFound extends BadRequest {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function fail(err: unknown) {
  if (err instanceof BadRequest) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Unique-constraint violations from the database are the data-integrity net
  // doing its job (double tap, two phones) — surface them as conflicts, not 500s.
  const code = (err as { code?: string })?.code;
  if (code === "23505") {
    return NextResponse.json({ error: "That was already recorded." }, { status: 409 });
  }
  if (code === "23514") {
    return NextResponse.json({ error: "That value isn't allowed." }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : "Something went wrong";
  console.error("[api]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new BadRequest("Expected a JSON body");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequest(`${field} is required`);
  return value;
}

/** 1–10 in half points. */
export function parseScore(value: unknown, field = "score"): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new BadRequest(`${field} must be a number`);
  if (n < 1 || n > 10) throw new BadRequest(`${field} must be between 1 and 10`);
  if (n * 2 !== Math.floor(n * 2)) throw new BadRequest(`${field} must be a whole or half number`);
  return n;
}

export function parseSnackScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequest("score must be 1–5");
  return n;
}

export function parseText(value: unknown, field: string, max: number, required = true): string | null {
  if (value == null || value === "") {
    if (required) throw new BadRequest(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new BadRequest(`${field} must be text`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new BadRequest(`${field} can't be empty`);
  if (trimmed.length > max) throw new BadRequest(`${field} is too long (${max} characters max)`);
  return trimmed || null;
}

export function parseSnackKind(value: unknown): SnackKind {
  if (typeof value !== "string" || !SNACK_KINDS.includes(value as SnackKind)) {
    throw new BadRequest("kind must be snack or drink");
  }
  return value as SnackKind;
}

export function parseInt_(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) throw new BadRequest(`${field} must be a whole number`);
  return n;
}
