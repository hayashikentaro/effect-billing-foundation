import { Effect, pipe } from "effect"
import { createInvoice, isOverdue, transitionInvoice } from "../domain/invoice.js"
import type { Invoice } from "../domain/invoice.js"
import { totalPaidAmount, type Payment } from "../domain/payment.js"
import type { WorkflowEvent } from "../domain/workflow-event.js"
import { AiGateway } from "../services/ai-gateway.js"
import { Clock } from "../services/clock.js"
import { InvoiceRepo } from "../services/invoice-repo.js"
import { MailGateway } from "../services/mail-gateway.js"
import { PaymentGateway } from "../services/payment-gateway.js"
import { WorkflowLogger } from "../services/workflow-logger.js"
import type { CustomerInvoiceImporter } from "../adapters/customers/customer-invoice-importer.js"
import { TenantBoundaryViolationError } from "../domain/errors.js"

const withRetries = <A, E>(
  makeEffect: () => Effect.Effect<A, E>,
  retries = 2
): Effect.Effect<A, E> =>
  pipe(
    makeEffect(),
    Effect.catchAll((error) =>
      retries > 0 ? withRetries(makeEffect, retries - 1) : Effect.fail(error)
    )
  )

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const recordFailure = (
  event: Omit<Extract<WorkflowEvent, { type: "WorkflowFailed" }>, "type" | "at">
) =>
  Effect.gen(function* () {
    const logger = yield* WorkflowLogger
    const clock = yield* Clock
    const at = yield* clock.now

    yield* logger.record({
      type: "WorkflowFailed",
      at,
      ...event
    })
  })

const saveWithStatus = (
  invoice: Invoice,
  nextStatus: "sent" | "paid" | "overdue" | "reminded",
  eventFactory: (at: Date) => WorkflowEvent
) =>
  Effect.gen(function* () {
    const repo = yield* InvoiceRepo
    const logger = yield* WorkflowLogger
    const clock = yield* Clock
    const updated = yield* transitionInvoice(invoice, nextStatus)
    const at = yield* clock.now

    yield* repo.save(updated)
    yield* logger.record(eventFactory(at))

    return updated
  })

const loadInvoiceForTenant = (params: {
  readonly invoiceId: string
  readonly tenantId: string
  readonly step: string
}) =>
  Effect.gen(function* () {
    const repo = yield* InvoiceRepo
    const logger = yield* WorkflowLogger
    const clock = yield* Clock
    const invoice = yield* repo.findById(params.invoiceId)

    if (invoice.tenantId === params.tenantId) {
      return invoice
    }

    const at = yield* clock.now

    yield* logger.record({
      type: "TenantBoundaryViolation",
      at,
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      requestedTenantId: params.tenantId,
      actualTenantId: invoice.tenantId,
      step: params.step
    })

    return yield* Effect.fail(
      new TenantBoundaryViolationError({
        invoiceId: invoice.id,
        requestedTenantId: params.tenantId,
        actualTenantId: invoice.tenantId,
        step: params.step,
        detail: `Invoice ${invoice.id} belongs to tenant ${invoice.tenantId}, not ${params.tenantId}`
      })
    )
  })

// "created" means imported but not yet delivered, so collections must skip it.
const isReminderEligible = (invoice: Invoice) =>
  invoice.status === "sent" ||
  invoice.status === "overdue" ||
  invoice.status === "reminded"

export const importAndSendInvoices = (params: {
  readonly tenantId: string
  readonly csvText: string
  readonly importer: CustomerInvoiceImporter
}) =>
  Effect.gen(function* () {
    const repo = yield* InvoiceRepo
    const mail = yield* MailGateway
    const logger = yield* WorkflowLogger
    const clock = yield* Clock
    const normalizedRows = yield* params.importer.decodeCsv(params.csvText)

    return yield* Effect.forEach(normalizedRows, (normalizedRow) =>
      {
        let invoiceId: string | undefined

        return Effect.gen(function* () {
          const at = yield* clock.now

          yield* logger.record({
            type: "InvoiceImported",
            at,
            tenantId: params.tenantId,
            importerId: normalizedRow.importerId,
            externalRef: normalizedRow.externalRef,
            rowNumber: normalizedRow.rowNumber
          })

          const invoice = yield* createInvoice(params.tenantId, normalizedRow, at)
          invoiceId = invoice.id

          yield* repo.save(invoice)
          yield* logger.record({
            type: "InvoiceCreated",
            at,
            tenantId: invoice.tenantId,
            invoiceId: invoice.id,
            status: invoice.status
          })

          yield* withRetries(() => mail.sendInvoice(invoice))

          return yield* saveWithStatus(invoice, "sent", (sentAt) => ({
            type: "InvoiceSent",
            at: sentAt,
            tenantId: invoice.tenantId,
            invoiceId: invoice.id,
            status: "sent"
          }))
        }).pipe(
          Effect.tapError((error) =>
            recordFailure({
              tenantId: params.tenantId,
              step: "importAndSendInvoices",
              invoiceId,
              detail: formatError(error)
            })
          )
        )
      }
    )
  })

export const confirmPayment = (params: {
  readonly tenantId: string
  readonly invoiceId: string
}) =>
  Effect.gen(function* () {
    const paymentGateway = yield* PaymentGateway
    const invoice = yield* loadInvoiceForTenant({
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      step: "confirmPayment"
    })
    const payments = yield* withRetries(() => paymentGateway.findPayments(invoice.id))

    if (totalPaidAmount(payments) < invoice.amount || invoice.status === "paid") {
      return {
        invoice,
        payments,
        confirmed: false
      }
    }

    const updated = yield* saveWithStatus(invoice, "paid", (at) => ({
      type: "PaymentConfirmed",
      at,
      tenantId: invoice.tenantId,
      invoiceId: invoice.id,
      paymentIds: payments.map((payment) => payment.id),
      status: "paid"
    }))

    return {
      invoice: updated,
      payments,
      confirmed: true
    }
  }).pipe(
    Effect.tapError((error) =>
      error instanceof TenantBoundaryViolationError
        ? Effect.void
        : recordFailure({
            tenantId: params.tenantId,
            step: "confirmPayment",
            invoiceId: params.invoiceId,
            detail: formatError(error)
          })
    )
  )

export const recordPayment = (payment: Payment) =>
  Effect.gen(function* () {
    const gateway = yield* PaymentGateway
    yield* gateway.recordPayment(payment)
  })

export const sendReminderIfOverdue = (params: {
  readonly tenantId: string
  readonly invoiceId: string
}) =>
  Effect.gen(function* () {
    const ai = yield* AiGateway
    const mail = yield* MailGateway
    const clock = yield* Clock
    const invoice = yield* loadInvoiceForTenant({
      tenantId: params.tenantId,
      invoiceId: params.invoiceId,
      step: "sendReminderIfOverdue"
    })

    if (!isReminderEligible(invoice) || invoice.status === "paid") {
      return { reminded: false }
    }

    const now = yield* clock.now

    if (!isOverdue(invoice, now)) {
      return { reminded: false }
    }

    const overdueInvoice =
      invoice.status === "overdue" || invoice.status === "reminded"
        ? invoice
        : yield* saveWithStatus(invoice, "overdue", (at) => ({
            type: "InvoiceOverdue",
            at,
            tenantId: invoice.tenantId,
            invoiceId: invoice.id,
            status: "overdue"
          }))

    if (overdueInvoice.status === "reminded") {
      return { reminded: false }
    }

    const draft = yield* withRetries(() => ai.draftReminder(overdueInvoice))
    yield* withRetries(() => mail.sendReminder(overdueInvoice, draft))
    yield* saveWithStatus(overdueInvoice, "reminded", (at) => ({
      type: "ReminderSent",
      at,
      tenantId: overdueInvoice.tenantId,
      invoiceId: overdueInvoice.id,
      status: "reminded"
    }))

    return { reminded: true }
  }).pipe(
    Effect.tapError((error) =>
      error instanceof TenantBoundaryViolationError
        ? Effect.void
        : recordFailure({
            tenantId: params.tenantId,
            step: "sendReminderIfOverdue",
            invoiceId: params.invoiceId,
            detail: formatError(error)
          })
    )
  )
