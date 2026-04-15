import type { Effect } from "effect"
import type { InputValidationError } from "../../domain/errors.js"
import type { NormalizedInvoiceInput } from "../../schema/normalized-input.js"

export interface CustomerInvoiceImporter {
  readonly importerId: string
  readonly decodeCsv: (
    csvText: string
  ) => Effect.Effect<ReadonlyArray<NormalizedInvoiceInput>, InputValidationError>
}
