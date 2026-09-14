import { fail, ok } from "@/lib/http";
import { movieGenres } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok(await movieGenres());
  } catch (err) {
    return fail(err);
  }
}
