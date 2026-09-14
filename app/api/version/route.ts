import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({ build: process.env.APP_BUILD_ID ?? "dev", builtAt: process.env.APP_BUILT_AT ?? "" });
}
