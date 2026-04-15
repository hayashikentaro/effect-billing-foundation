import assert from "node:assert/strict"
import test from "node:test"
import { Effect, pipe } from "effect"
import { AcmeInvoiceImporter } from "../src/adapters/customers/acme-csv.js"
import { InfrastructureError } from "../src/domain/errors.js"
import { isOverdue, type Invoice } from "../src/domain/invoice.js"
import { makeAppLayer } from "../src/layers/live.js"
import { InvoiceRepo } from "../src/services/invoice-repo.js"
import { MailGateway } from "../src/services/mail-gateway.js"
import { WorkflowLogger } from "../src/services/workflow-logger.js"
import {
  confirmPayment,
  importAndSendInvoices,
  sendReminderIfOverdue
} from "../src/workflows/invoice-workflows.js"

test("rejects cross-tenant workflow operations and audits the violation", async () => {
  const program = Effect.gen(function* () {
    const logger = yield* WorkflowLogger

    const [invoice] = yield* importAndSendInvoices({
      tenantId: "tenant-a",
      csvText: `bill_no,client_name,client_email,amount_jpy,due_date
INV-X,Alpha Co,alpha@example.com,50000,2026-04-10`,
      importer: AcmeInvoiceImporter
    })

    const paymentAttempt = yield* Effect.either(
      confirmPayment({
        tenantId: "tenant-b",
        invoiceId: invoice.id
      })
    )

    const reminderAttempt = yield* Effect.either(
      sendReminderIfOverdue({
        tenantId: "tenant-b",
        invoiceId: invoice.id
      })
    )

    return {
      paymentAttempt,
      reminderAttempt,
      events: yield* logger.list()
    }
  })

  const result = await pipe(
    program,
    Effect.provide(makeAppLayer({ now: new Date("2026-04-15T09:00:00.000Z") })),
    Effect.runPromise
  )

  assert.equal(result.paymentAttempt._tag, "Left")
  assert.equal(result.reminderAttempt._tag, "Left")

  if (result.paymentAttempt._tag === "Left") {
    assert.equal(result.paymentAttempt.left._tag, "TenantBoundaryViolationError")
    assert.equal(result.paymentAttempt.left.requestedTenantId, "tenant-b")
    assert.equal(result.paymentAttempt.left.actualTenantId, "tenant-a")
  }

  if (result.reminderAttempt._tag === "Left") {
    assert.equal(result.reminderAttempt.left._tag, "TenantBoundaryViolationError")
    assert.equal(result.reminderAttempt.left.requestedTenantId, "tenant-b")
    assert.equal(result.reminderAttempt.left.actualTenantId, "tenant-a")
  }

  const violations = result.events.filter(
    (event) => event.type === "TenantBoundaryViolation"
  )

  assert.equal(violations.length, 2)
  assert.deepEqual(
    violations.map((event) => ({
      invoiceId: event.invoiceId,
      requestedTenantId: event.requestedTenantId,
      actualTenantId: event.actualTenantId,
      step: event.step
    })),
    [
      {
        invoiceId: "inv-tenant-a-INV-X",
        requestedTenantId: "tenant-b",
        actualTenantId: "tenant-a",
        step: "confirmPayment"
      },
      {
        invoiceId: "inv-tenant-a-INV-X",
        requestedTenantId: "tenant-b",
        actualTenantId: "tenant-a",
        step: "sendReminderIfOverdue"
      }
    ]
  )
})

test("does not mark an invoice overdue until the due date has fully ended", () => {
  const invoice: Invoice = {
    id: "inv-boundary",
    tenantId: "tenant-test",
    externalRef: "INV-BOUNDARY",
    customerName: "Boundary Co",
    customerEmail: "billing@boundary.example",
    amount: 1000,
    currency: "JPY",
    issuedAt: new Date("2026-04-10T00:00:00.000Z"),
    dueDate: new Date("2026-04-15T00:00:00.000Z"),
    status: "sent",
    source: {
      importerId: "test",
      rowNumber: 1,
      raw: {}
    }
  }

  assert.equal(isOverdue(invoice, new Date("2026-04-15T23:59:59.999Z")), false)
  assert.equal(isOverdue(invoice, new Date("2026-04-16T00:00:00.000Z")), true)
})

test("keeps failed deliveries in created status and skips reminder workflow", async () => {
  const failingMailGateway = {
    sendInvoice: () =>
      Effect.fail(
        new InfrastructureError({
          service: "mail-gateway",
          operation: "sendInvoice",
          detail: "Simulated delivery failure",
          retryable: true
        })
      ),
    sendReminder: () => Effect.succeed<void>(undefined)
  }

  const program = Effect.gen(function* () {
    const repo = yield* InvoiceRepo
    const logger = yield* WorkflowLogger

    const importResult = yield* Effect.either(
      importAndSendInvoices({
        tenantId: "tenant-test",
        csvText: `bill_no,client_name,client_email,amount_jpy,due_date
INV-CREATED,Alpha Co,alpha@example.com,50000,2026-04-01`,
        importer: AcmeInvoiceImporter
      })
    )

    const invoices = yield* repo.list()
    const [invoice] = invoices

    const reminderResult = invoice
      ? yield* Effect.either(
          sendReminderIfOverdue({
            tenantId: "tenant-test",
            invoiceId: invoice.id
          })
        )
      : { _tag: "Right" as const, right: { reminded: false } }

    return {
      importResult,
      invoices,
      reminderResult,
      events: yield* logger.list()
    }
  })

  const result = await pipe(
    program,
    Effect.provideService(MailGateway, failingMailGateway),
    Effect.provide(makeAppLayer({ now: new Date("2026-04-15T09:00:00.000Z") })),
    Effect.runPromise
  )

  assert.equal(result.importResult._tag, "Left")

  if (result.importResult._tag === "Left") {
    assert.equal(result.importResult.left._tag, "InfrastructureError")
  }

  const [invoice] = result.invoices
  assert.ok(invoice)
  assert.equal(invoice.status, "created")
  assert.equal(result.reminderResult._tag, "Right")

  if (result.reminderResult._tag === "Right") {
    assert.equal(result.reminderResult.right.reminded, false)
  }

  const failureEvent = result.events.find(
    (event) =>
      event.type === "WorkflowFailed" &&
      event.step === "importAndSendInvoices" &&
      event.invoiceId === invoice.id
  )

  assert.ok(failureEvent)
})
