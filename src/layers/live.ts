import { Effect, Layer } from "effect"
import { EntityNotFoundError, toInfrastructureError } from "../domain/errors.js"
import type { Invoice } from "../domain/invoice.js"
import type { Payment } from "../domain/payment.js"
import type { WorkflowEvent } from "../domain/workflow-event.js"
import { AiGateway } from "../services/ai-gateway.js"
import { Clock } from "../services/clock.js"
import { InvoiceRepo } from "../services/invoice-repo.js"
import { MailGateway } from "../services/mail-gateway.js"
import { PaymentGateway } from "../services/payment-gateway.js"
import { WorkflowLogger } from "../services/workflow-logger.js"

const toDetail = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const makeInvoiceRepoLayer = Layer.sync(InvoiceRepo, () => {
  const storage = new Map<string, Invoice>()

  return {
    save: (invoice: Invoice) =>
      Effect.try({
        try: () => {
          storage.set(invoice.id, invoice)
        },
        catch: (error) =>
          toInfrastructureError(
            "invoice-repo",
            "save",
            toDetail(error, "Failed to save invoice")
          )
      }),
    findById: (invoiceId: string) =>
      Effect.sync(() => storage.get(invoiceId)).pipe(
        Effect.flatMap((invoice) =>
          invoice
            ? Effect.succeed(invoice)
            : Effect.fail(
                new EntityNotFoundError({
                  entity: "Invoice",
                  id: invoiceId
                })
              )
        )
      ),
    list: () =>
      Effect.try({
        try: () => Array.from(storage.values()),
        catch: (error) =>
          toInfrastructureError(
            "invoice-repo",
            "list",
            toDetail(error, "Failed to list invoices")
          )
      })
  }
})

const makePaymentGatewayLayer = Layer.sync(PaymentGateway, () => {
  const storage = new Map<string, Array<Payment>>()

  return {
    recordPayment: (payment: Payment) =>
      Effect.try({
        try: () => {
          const payments = storage.get(payment.invoiceId) ?? []
          payments.push(payment)
          storage.set(payment.invoiceId, payments)
        },
        catch: (error) =>
          toInfrastructureError(
            "payment-gateway",
            "recordPayment",
            toDetail(error, "Failed to record payment")
          )
      }),
    findPayments: (invoiceId: string) =>
      Effect.try({
        try: () => [...(storage.get(invoiceId) ?? [])],
        catch: (error) =>
          toInfrastructureError(
            "payment-gateway",
            "findPayments",
            toDetail(error, "Failed to find payments"),
            true
          )
      })
  }
})

const makeMailGatewayLayer = Layer.sync(MailGateway, () => {
  const sentMessages: Array<{ kind: "invoice" | "reminder"; invoiceId: string }> = []

  return {
    sendInvoice: (invoice: Invoice) =>
      Effect.try({
        try: () => {
          sentMessages.push({
            kind: "invoice",
            invoiceId: invoice.id
          })
        },
        catch: (error) =>
          toInfrastructureError(
            "mail-gateway",
            "sendInvoice",
            toDetail(error, "Failed to send invoice"),
            true
          )
      }),
    sendReminder: (invoice: Invoice) =>
      Effect.try({
        try: () => {
          sentMessages.push({
            kind: "reminder",
            invoiceId: invoice.id
          })
        },
        catch: (error) =>
          toInfrastructureError(
            "mail-gateway",
            "sendReminder",
            toDetail(error, "Failed to send reminder"),
            true
          )
      })
  }
})

const makeWorkflowLoggerLayer = Layer.sync(WorkflowLogger, () => {
  const events: Array<WorkflowEvent> = []

  return {
    record: (event: WorkflowEvent) =>
      Effect.try({
        try: () => {
          events.push(event)
        },
        catch: (error) =>
          toInfrastructureError(
            "workflow-logger",
            "record",
            toDetail(error, "Failed to record event")
          )
      }),
    list: () =>
      Effect.try({
        try: () => [...events],
        catch: (error) =>
          toInfrastructureError(
            "workflow-logger",
            "list",
            toDetail(error, "Failed to list events")
          )
      })
  }
})

const liveClockLayer = Layer.succeed(Clock, {
  now: Effect.sync(() => new Date())
})

export const makeFixedClockLayer = (now: Date) =>
  Layer.succeed(Clock, {
    now: Effect.succeed(now)
  })

const aiGatewayLayer = Layer.succeed(AiGateway, {
  draftReminder: (invoice: Invoice) =>
    Effect.succeed({
      subject: `お支払いのお願い: ${invoice.externalRef}`,
      body: `${invoice.customerName} 様\n請求書 ${invoice.externalRef} のお支払い確認が取れていません。ご確認をお願いします。`
    })
})

export const makeAppLayer = (options?: { readonly now?: Date }) =>
  Layer.mergeAll(
    makeInvoiceRepoLayer,
    makePaymentGatewayLayer,
    makeMailGatewayLayer,
    makeWorkflowLoggerLayer,
    aiGatewayLayer,
    options?.now ? makeFixedClockLayer(options.now) : liveClockLayer
  )
