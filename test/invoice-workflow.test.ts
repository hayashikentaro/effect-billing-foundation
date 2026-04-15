import assert from "node:assert/strict"
import test from "node:test"
import { Effect, pipe } from "effect"
import { AcmeInvoiceImporter } from "../src/adapters/customers/acme-csv.js"
import { makeAppLayer } from "../src/layers/live.js"
import { InvoiceRepo } from "../src/services/invoice-repo.js"
import {
  confirmPayment,
  importAndSendInvoices,
  recordPayment,
  sendReminderIfOverdue
} from "../src/workflows/invoice-workflows.js"

test("imports invoices, confirms payment, and reminds overdue invoices", async () => {
  const program = Effect.gen(function* () {
    const repo = yield* InvoiceRepo

    const invoices = yield* importAndSendInvoices({
      tenantId: "tenant-test",
      csvText: `bill_no,client_name,client_email,amount_jpy,due_date
INV-A,Alpha Co,alpha@example.com,50000,2026-04-01
INV-B,Beta Co,beta@example.com,80000,2026-04-05`,
      importer: AcmeInvoiceImporter
    })

    yield* recordPayment({
      id: "pay-test-1",
      invoiceId: invoices[0].id,
      amount: 50000,
      paidAt: new Date("2026-04-10T00:00:00.000Z"),
      method: "bank_transfer",
      reference: "TEST-REF-1"
    })

    const paymentResult = yield* confirmPayment({
      tenantId: "tenant-test",
      invoiceId: invoices[0].id
    })

    const reminderResult = yield* sendReminderIfOverdue({
      tenantId: "tenant-test",
      invoiceId: invoices[1].id
    })

    return {
      invoices: yield* repo.list(),
      paymentResult,
      reminderResult
    }
  })

  const result = await pipe(
    program,
    Effect.provide(makeAppLayer({ now: new Date("2026-04-15T09:00:00.000Z") })),
    Effect.runPromise
  )

  const paidInvoice = result.invoices.find((invoice) => invoice.externalRef === "INV-A")
  const remindedInvoice = result.invoices.find(
    (invoice) => invoice.externalRef === "INV-B"
  )

  assert.ok(paidInvoice)
  assert.ok(remindedInvoice)
  assert.equal(paidInvoice.status, "paid")
  assert.equal(remindedInvoice.status, "reminded")
  assert.equal(result.paymentResult.confirmed, true)
  assert.equal(result.reminderResult.reminded, true)
})
