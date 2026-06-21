export const SCORE_MIN = 0
export const SCORE_MAX = 100

export function clampScore(value: number): number {
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value))
}

export function roundScore(value: number): number {
  return Math.round(clampScore(value))
}
