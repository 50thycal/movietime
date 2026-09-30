import { NextResponse } from "next/server";
import { fail, parseInt_ } from "@/lib/http";
import { movieWithExtras } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

/** One film with trailer, cast, certification and where to watch it. */
export async function GET(_req: Request, { params }: { params: Promise<{ tmdbId: string }> }) {
  try {
    const tmdbId = parseInt_((await params).tmdbId, "tmdbId");
    // Metadata, not group state: let the phone keep it for a while.
    return NextResponse.json(await movieWithExtras(tmdbId), { headers: { "cache-control": "private, max-age=3600" } });
  } catch (err) {
    return fail(err);
  }
}
