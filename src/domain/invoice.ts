import { Effect } from "effect"
import type { NormalizedInvoiceInput } from "../schema/normalized-input.js"
import { InputValidationError, RuleViolationError } from "./errors.js"

export type InvoiceStatus =
  | "created"
  | "sent"
  | "paid"
  | "overdue"
  | "reminded"

export interface Invoice {
  readonly id: string
  readonly tenantId: string
  readonly externalRef: string
  readonly customerName: string
  readonly customerEmail: string
  readonly amount: number
  readonly currency: "JPY"
  readonly issuedAt: Date
  readonly dueDate: Date
  readonly status: InvoiceStatus
  readonly source: {
    readonly importerId: string
    readonly rowNumber: number
    readonly raw: Readonly<Record<string, string>>
  }
}

const allowedTransitions: Record<InvoiceStatus, ReadonlyArray<InvoiceStatus>> = {
  created: ["sent"],
  sent: ["paid", "overdue"],
  paid: [],
  overdue: ["paid", "reminded"],
  reminded: ["paid"]
}

const toDueDate = (
  input: NormalizedInvoiceInput
): Effect.Effect<Date, InputValidationError> =>
  Effect.sync(() => new Date(`${input.dueDateIso}T00:00:00.000Z`)).pipe(
    Effect.flatMap((dueDate) =>
      Number.isNaN(dueDate.getTime())
        ? Effect.fail(
            new InputValidationError({
              source: `${input.importerId}:${input.rowNumber}`,
              detail: `Invalid due date: ${input.dueDateIso}`
            })
          )
        : Effect.succeed(dueDate)
    )
  )

export const buildInvoiceId = (tenantId: string, externalRef: string) =>
  `inv-${tenantId}-${externalRef}`.replace(/[^a-zA-Z0-9-_]/g, "_")

export const createInvoice = (
  tenantId: string,
  input: NormalizedInvoiceInput,
  issuedAt: Date
): Effect.Effect<Invoice, InputValidationError> =>
  toDueDate(input).pipe(
    Effect.map((dueDate) => ({
      id: buildInvoiceId(tenantId, input.externalRef),
      tenantId,
      externalRef: input.externalRef,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      amount: input.amount,
      currency: input.currency,
      issuedAt,
      dueDate,
      status: "created" as const,
      source: {
        importerId: input.importerId,
        rowNumber: input.rowNumber,
        raw: input.raw
      }
    }))
  )

export const transitionInvoice = (
  invoice: Invoice,
  nextStatus: InvoiceStatus
): Effect.Effect<Invoice, RuleViolationError> =>
  allowedTransitions[invoice.status].includes(nextStatus)
    ? Effect.succeed({
        ...invoice,
        status: nextStatus
      })
    : Effect.fail(
        new RuleViolationError({
          rule: "InvoiceStatusTransition",
          detail: `Cannot change invoice ${invoice.id} from ${invoice.status} to ${nextStatus}`
        })
      )

export const isOverdue = (invoice: Invoice, now: Date) =>
  invoice.status !== "paid" && invoice.dueDate.getTime() < now.getTime()
