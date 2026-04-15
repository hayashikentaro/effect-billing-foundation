import { Schema } from "effect"

export const NormalizedInvoiceInputSchema = Schema.Struct({
  importerId: Schema.String,
  rowNumber: Schema.Number,
  externalRef: Schema.String,
  customerName: Schema.String,
  customerEmail: Schema.String,
  amount: Schema.Number,
  currency: Schema.Literal("JPY"),
  dueDateIso: Schema.String,
  raw: Schema.Record({
    key: Schema.String,
    value: Schema.String
  })
})

export type NormalizedInvoiceInput = Schema.Schema.Type<
  typeof NormalizedInvoiceInputSchema
>
