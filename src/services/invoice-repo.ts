import { Context, type Effect } from "effect"
import type {
  EntityNotFoundError,
  InfrastructureError
} from "../domain/errors.js"
import type { Invoice } from "../domain/invoice.js"

/**
 * Hides persistence details such as DB vendor, query shape, and transaction code.
 * Common because every tenant-specific workflow still needs the same invoice store contract.
 */
export interface InvoiceRepoService {
  readonly save: (invoice: Invoice) => Effect.Effect<void, InfrastructureError>
  readonly findById: (
    invoiceId: string
  ) => Effect.Effect<Invoice, EntityNotFoundError | InfrastructureError>
  readonly list: () => Effect.Effect<ReadonlyArray<Invoice>, InfrastructureError>
}

export const InvoiceRepo = Context.GenericTag<InvoiceRepoService>("InvoiceRepo")
