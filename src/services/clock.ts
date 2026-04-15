import { Context, type Effect } from "effect"

/**
 * Hides system time access so overdue checks remain deterministic in tests and batch runs.
 * Common because every tenant's SLA and due-date logic depends on a stable time source.
 */
export interface ClockService {
  readonly now: Effect.Effect<Date>
}

export const Clock = Context.GenericTag<ClockService>("Clock")
