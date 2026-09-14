import type { Member, RotationInfo } from "./types";

/** Active members in rotation order. */
export function rotationOrder(members: Member[]): Member[] {
  return members
    .filter((m) => m.active)
    .slice()
    .sort((a, b) => a.rotation_position - b.rotation_position || a.name.localeCompare(b.name));
}

/**
 * Who is next after `memberId`, wrapping around. If that member has gone
 * inactive (or is unknown), fall back to the first active member so the
 * rotation never gets stuck pointing at nobody.
 */
export function nextAfter(members: Member[], memberId: string | null): Member | null {
  const order = rotationOrder(members);
  if (order.length === 0) return null;
  const idx = order.findIndex((m) => m.id === memberId);
  if (idx === -1) return order[0];
  return order[(idx + 1) % order.length];
}

/** The current selector plus the next few in line. */
export function rotationInfo(members: Member[], currentId: string | null, upcoming = 3): RotationInfo {
  const order = rotationOrder(members);
  if (order.length === 0) return { current: null, upcoming: [] };
  let idx = order.findIndex((m) => m.id === currentId);
  if (idx === -1) idx = 0;
  const current = order[idx];
  const rest: Member[] = [];
  for (let i = 1; i <= Math.min(upcoming, order.length - 1); i++) rest.push(order[(idx + i) % order.length]);
  return { current, upcoming: rest };
}
