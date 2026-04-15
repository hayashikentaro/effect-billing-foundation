import { Effect, pipe } from "effect"
import { createInvoice, isOverdue, transitionInvoice } from "../domain/invoice.js"
import { totalPaidAmount, type Payment } from "../domain/payment.js"
import type { WorkflowEvent } from "../domain/workflow-event.js"
import { AiGateway } from "../services/ai-gateway.js"
import { Clock } from "../services/clock.js"
import { InvoiceRepo } from "../services/invoice-repo.js"
import { MailGateway } from "../services/mail-gateway.js"
import { PaymentGateway } from "../services/payment-gateway.js"
import { WorkflowLogger } from "../services/workflow-logger.js"
import type { CustomerInvoiceImporter } from "../adapters/customers/customer-invoice-importer.js"

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
  invoiceId: string,
  nextStatus: "sent" | "paid" | "overdue" | "reminded",
  eventFactory: (at: Date) => WorkflowEvent
) =>
  Effect.gen(function* () {
    const repo = yield* InvoiceRepo
    const logger = yield* WorkflowLogger
    const clock = yield* Clock
    const invoice = yield* repo.findById(invoiceId)
    const updated = yield* transitionInvoice(invoice, nextStatus)
    const at = yield* clock.now

    yield* repo.save(updated)
    yield* logger.record(eventFactory(at))

    return updated
  })

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
      Effect.gen(function* () {
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
        yield* repo.save(invoice)
        yield* logger.record({
          type: "InvoiceCreated",
          at,
          tenantId: params.tenantId,
          invoiceId: invoice.id,
          status: invoice.status
        })

        yield* withRetries(() => mail.sendInvoice(invoice))

        return yield* saveWithStatus(invoice.id, "sent", (sentAt) => ({
          type: "InvoiceSent",
          at: sentAt,
          tenantId: params.tenantId,
          invoiceId: invoice.id,
          status: "sent"
        }))
      }).pipe(
        Effect.tapError((error) =>
          recordFailure({
            tenantId: params.tenantId,
            step: "importAndSendInvoices",
            detail: String(error)
          })
        )
      )
    )
  })

export const confirmPayment = (params: {
  readonly tenantId: string
  readonly invoiceId: string
}) =>
  Effect.gen(function* () {
    const repo = yield* InvoiceRepo
    const paymentGateway = yield* PaymentGateway
    const invoice = yield* repo.findById(params.invoiceId)
    const payments = yield* withRetries(() => paymentGateway.findPayments(invoice.id))

    if (totalPaidAmount(payments) < invoice.amount || invoice.status === "paid") {
      return {
        invoice,
        payments,
        confirmed: false
      }
    }

    const updated = yield* saveWithStatus(invoice.id, "paid", (at) => ({
      type: "PaymentConfirmed",
      at,
      tenantId: params.tenantId,
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
      recordFailure({
        tenantId: params.tenantId,
        step: "confirmPayment",
        invoiceId: params.invoiceId,
        detail: String(error)
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
    const repo = yield* InvoiceRepo
    const ai = yield* AiGateway
    const mail = yield* MailGateway
    const clock = yield* Clock
    const invoice = yield* repo.findById(params.invoiceId)
    const now = yield* clock.now

    if (!isOverdue(invoice, now) || invoice.status === "paid") {
      return { reminded: false }
    }

    const overdueInvoice =
      invoice.status === "overdue" || invoice.status === "reminded"
        ? invoice
        : yield* saveWithStatus(invoice.id, "overdue", (at) => ({
            type: "InvoiceOverdue",
            at,
            tenantId: params.tenantId,
            invoiceId: invoice.id,
            status: "overdue"
          }))

    if (overdueInvoice.status === "reminded") {
      return { reminded: false }
    }

    const draft = yield* withRetries(() => ai.draftReminder(overdueInvoice))
    yield* withRetries(() => mail.sendReminder(overdueInvoice, draft))
    yield* saveWithStatus(overdueInvoice.id, "reminded", (at) => ({
      type: "ReminderSent",
      at,
      tenantId: params.tenantId,
      invoiceId: overdueInvoice.id,
      status: "reminded"
    }))

    return { reminded: true }
  }).pipe(
    Effect.tapError((error) =>
      recordFailure({
        tenantId: params.tenantId,
        step: "sendReminderIfOverdue",
        invoiceId: params.invoiceId,
        detail: String(error)
      })
    )
  )
