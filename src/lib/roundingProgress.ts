import type { RoundingDateSummary } from './patientStore'

// Progress for one rounding date. Floored, so 100% only ever means every
// patient is actually done (199 of 200 shows 99%, not a rounded-up 100%).
// A date with no patients has no meaningful percentage — null, not 0/NaN.
export function progressPercent({ total, complete }: RoundingDateSummary): number | null {
  if (total <= 0) return null
  return Math.floor((Math.min(complete, total) / total) * 100)
}

export interface HomeRounds {
  // Today's round, or the most recent past one when there isn't one today.
  current: RoundingDateSummary | null
  // Future-dated rounds (e.g. a census imported ahead of time), soonest first.
  upcoming: RoundingDateSummary[]
  // Everything older than current, newest first.
  previous: RoundingDateSummary[]
}

// dates: listRoundingDates() output (newest first). today: YYYY-MM-DD.
// Keys are YYYY-MM-DD, so string comparison is date comparison.
export function groupRoundsForHome(dates: RoundingDateSummary[], today: string): HomeRounds {
  const upcoming = dates.filter((d) => d.date > today).reverse()
  const pastOrToday = dates.filter((d) => d.date <= today)
  const [current = null, ...previous] = pastOrToday
  return { current, upcoming, previous }
}
