import type { Rating } from "./types";

export interface RatingSummary {
  count: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  spread: number | null;
  selector_score: number | null;
  average_excluding_selector: number | null;
  /** selector minus the others' average: positive = selector liked it more than the group */
  selector_delta: number | null;
}

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10;
}

/** Everything the reveal screen shows, from a set of ratings and who picked the film. */
export function summarizeRatings(ratings: Pick<Rating, "member_id" | "score">[], selectorId: string): RatingSummary {
  const scores = ratings.map((r) => r.score);
  if (scores.length === 0) {
    return {
      count: 0,
      average: null,
      highest: null,
      lowest: null,
      spread: null,
      selector_score: null,
      average_excluding_selector: null,
      selector_delta: null,
    };
  }
  const highest = Math.max(...scores);
  const lowest = Math.min(...scores);
  const selector = ratings.find((r) => r.member_id === selectorId)?.score ?? null;
  const others = ratings.filter((r) => r.member_id !== selectorId).map((r) => r.score);
  const othersAvg = mean(others);
  return {
    count: scores.length,
    average: round1(mean(scores)),
    highest,
    lowest,
    spread: round1(highest - lowest),
    selector_score: selector,
    average_excluding_selector: round1(othersAvg),
    selector_delta: selector != null && othersAvg != null ? round1(selector - othersAvg) : null,
  };
}

/**
 * Whether individual scores may be shown. Scores stay sealed until every
 * active member has rated, so nobody anchors on anybody else.
 */
export function ratingsRevealed(ratedMemberIds: string[], activeMemberIds: string[]): boolean {
  if (activeMemberIds.length === 0) return false;
  const rated = new Set(ratedMemberIds);
  return activeMemberIds.every((id) => rated.has(id));
}

/** Approval outcome for a proposal. Everyone other than the selector must approve. */
export function approvalOutcome(
  approvals: { member_id: string; decision: "approve" | "reject" }[],
  selectorId: string,
  activeMemberIds: string[],
): "approved" | "rejected" | "pending" {
  if (approvals.some((a) => a.decision === "reject")) return "rejected";
  const required = activeMemberIds.filter((id) => id !== selectorId);
  const approved = new Set(approvals.filter((a) => a.decision === "approve").map((a) => a.member_id));
  return required.every((id) => approved.has(id)) ? "approved" : "pending";
}
