import { Effect, Schema, pipe } from "effect"
import { InputValidationError } from "../../domain/errors.js"
import {
  NormalizedInvoiceInputSchema,
  type NormalizedInvoiceInput
} from "../../schema/normalized-input.js"
import { parseCsv } from "../infra/csv.js"
import type { CustomerInvoiceImporter } from "./customer-invoice-importer.js"

export const AcmeInvoiceCsvRowSchema = Schema.Struct({
  bill_no: Schema.String,
  client_name: Schema.String,
  client_email: Schema.String,
  amount_jpy: Schema.String,
  due_date: Schema.String
})

export type AcmeInvoiceCsvRow = Schema.Schema.Type<typeof AcmeInvoiceCsvRowSchema>

const normalizeIsoDate = (
  rawDate: string,
  rowNumber: number
): Effect.Effect<string, InputValidationError> =>
  /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? Effect.succeed(rawDate)
    : Effect.fail(
        new InputValidationError({
          source: `acme-csv:${rowNumber}`,
          detail: `due_date must be YYYY-MM-DD, got ${rawDate}`
        })
      )

const normalizeAmount = (
  rawAmount: string,
  rowNumber: number
): Effect.Effect<number, InputValidationError> => {
  const amount = Number.parseInt(rawAmount, 10)

  return Number.isFinite(amount) && amount > 0
    ? Effect.succeed(amount)
    : Effect.fail(
        new InputValidationError({
          source: `acme-csv:${rowNumber}`,
          detail: `amount_jpy must be a positive integer, got ${rawAmount}`
        })
      )
}

const normalizeEmail = (
  rawEmail: string,
  rowNumber: number
): Effect.Effect<string, InputValidationError> =>
  rawEmail.includes("@")
    ? Effect.succeed(rawEmail.trim().toLowerCase())
    : Effect.fail(
        new InputValidationError({
          source: `acme-csv:${rowNumber}`,
          detail: `client_email must look like an email address, got ${rawEmail}`
        })
      )

const decodeRow = (
  raw: Readonly<Record<string, string>>,
  rowNumber: number
): Effect.Effect<NormalizedInvoiceInput, InputValidationError> =>
  pipe(
    Schema.decodeUnknown(AcmeInvoiceCsvRowSchema)(raw),
    Effect.mapError(
      (error) =>
        new InputValidationError({
          source: `acme-csv:${rowNumber}`,
          detail: String(error)
        })
    ),
    Effect.flatMap((row) =>
      Effect.all({
        customerEmail: normalizeEmail(row.client_email, rowNumber),
        amount: normalizeAmount(row.amount_jpy, rowNumber),
        dueDateIso: normalizeIsoDate(row.due_date, rowNumber)
      }).pipe(
        Effect.flatMap(({ amount, customerEmail, dueDateIso }) =>
          Schema.decodeUnknown(NormalizedInvoiceInputSchema)({
            importerId: "acme-csv/v1",
            rowNumber,
            externalRef: row.bill_no.trim(),
            customerName: row.client_name.trim(),
            customerEmail,
            amount,
            currency: "JPY",
            dueDateIso,
            raw
          })
        ),
        Effect.mapError(
          (error) =>
            new InputValidationError({
              source: `acme-csv:${rowNumber}`,
              detail: String(error)
            })
        )
      )
    )
  )

export const AcmeInvoiceImporter: CustomerInvoiceImporter = {
  importerId: "acme-csv/v1",
  decodeCsv: (csvText) =>
    pipe(
      parseCsv(csvText),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row, index) => decodeRow(row, index + 2))
      )
    )
}
