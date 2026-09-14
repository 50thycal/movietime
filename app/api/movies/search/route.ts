import { fail, ok, BadRequest } from "@/lib/http";
import { searchMovies } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) throw new BadRequest("Type at least two characters");
    return ok(await searchMovies(q));
  } catch (err) {
    return fail(err);
  }
}
