import { Context, type Effect } from "effect"
import type { InfrastructureError } from "../domain/errors.js"
import type { Invoice } from "../domain/invoice.js"
import type { ReminderDraft } from "./mail-gateway.js"

/**
 * Hides model/provider choice, prompt construction, and response parsing.
 * Common because AI should behave like one workflow step, not leak provider code into business logic.
 */
export interface AiGatewayService {
  readonly draftReminder: (
    invoice: Invoice
  ) => Effect.Effect<ReminderDraft, InfrastructureError>
}

export const AiGateway = Context.GenericTag<AiGatewayService>("AiGateway")
