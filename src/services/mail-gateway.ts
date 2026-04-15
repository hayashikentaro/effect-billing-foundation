import { Context, type Effect } from "effect"
import type { InfrastructureError } from "../domain/errors.js"
import type { Invoice } from "../domain/invoice.js"

export interface ReminderDraft {
  readonly subject: string
  readonly body: string
}

/**
 * Hides SMTP/vendor SDK differences, templates, and transient delivery failures.
 * Common because "send invoice" and "send reminder" are reusable business capabilities across tenants.
 */
export interface MailGatewayService {
  readonly sendInvoice: (invoice: Invoice) => Effect.Effect<void, InfrastructureError>
  readonly sendReminder: (
    invoice: Invoice,
    draft: ReminderDraft
  ) => Effect.Effect<void, InfrastructureError>
}

export const MailGateway = Context.GenericTag<MailGatewayService>("MailGateway")
