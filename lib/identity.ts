import { BadRequest } from "./http";

/** Who is making the request. Set by the client from its remembered member. */
export function memberIdFrom(req: Request): string | null {
  const h = req.headers.get("x-member-id");
  if (h && /^[0-9a-f-]{36}$/i.test(h)) return h;
  const url = new URL(req.url);
  const q = url.searchParams.get("me");
  return q && /^[0-9a-f-]{36}$/i.test(q) ? q : null;
}

export function requireMemberId(req: Request): string {
  const id = memberIdFrom(req);
  if (!id) throw new BadRequest("Pick who you are first", 401);
  return id;
}
