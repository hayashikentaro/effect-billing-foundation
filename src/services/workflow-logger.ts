import { Context, type Effect } from "effect"
import type { InfrastructureError } from "../domain/errors.js"
import type { WorkflowEvent } from "../domain/workflow-event.js"

/**
 * Hides audit sink selection such as DB table, event bus, or external SIEM.
 * Common because auditability is a cross-cutting requirement regardless of tenant-specific rules.
 */
export interface WorkflowLoggerService {
  readonly record: (
    event: WorkflowEvent
  ) => Effect.Effect<void, InfrastructureError>
  readonly list: () => Effect.Effect<ReadonlyArray<WorkflowEvent>, InfrastructureError>
}

export const WorkflowLogger =
  Context.GenericTag<WorkflowLoggerService>("WorkflowLogger")
