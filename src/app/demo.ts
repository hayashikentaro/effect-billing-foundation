import { Effect, pipe } from "effect"
import { AcmeInvoiceImporter } from "../adapters/customers/acme-csv.js"
import { makeAppLayer } from "../layers/live.js"
import { InvoiceRepo } from "../services/invoice-repo.js"
import { WorkflowLogger } from "../services/workflow-logger.js"
import {
  confirmPayment,
  importAndSendInvoices,
  recordPayment,
  sendReminderIfOverdue
} from "../workflows/invoice-workflows.js"

const tenantId = "tenant-demo"

const demoCsv = `bill_no,client_name,client_email,amount_jpy,due_date
INV-1001,Alpha Co,accounting@alpha.example,120000,2026-04-10
INV-1002,Beta Co,ap@beta.example,98000,2026-04-01`

const demoProgram = Effect.gen(function* () {
  const repo = yield* InvoiceRepo
  const logger = yield* WorkflowLogger

  const sentInvoices = yield* importAndSendInvoices({
    tenantId,
    csvText: demoCsv,
    importer: AcmeInvoiceImporter
  })

  yield* recordPayment({
    id: "pay-001",
    invoiceId: sentInvoices[0].id,
    amount: 120000,
    paidAt: new Date("2026-04-14T09:30:00.000Z"),
    method: "bank_transfer",
    reference: "BANK-REF-001"
  })

  yield* confirmPayment({
    tenantId,
    invoiceId: sentInvoices[0].id
  })

  yield* sendReminderIfOverdue({
    tenantId,
    invoiceId: sentInvoices[1].id
  })

  return {
    invoices: yield* repo.list(),
    events: yield* logger.list()
  }
})

pipe(
  demoProgram,
  Effect.provide(makeAppLayer({ now: new Date("2026-04-15T09:00:00.000Z") })),
  Effect.runPromise
)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
