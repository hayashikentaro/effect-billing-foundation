import type { InvoiceStatus } from "./invoice.js"

interface EventBase {
  readonly at: Date
  readonly tenantId: string
}

export type WorkflowEvent =
  | (EventBase & {
      readonly type: "InvoiceImported"
      readonly importerId: string
      readonly externalRef: string
      readonly rowNumber: number
    })
  | (EventBase & {
      readonly type: "InvoiceCreated"
      readonly invoiceId: string
      readonly status: InvoiceStatus
    })
  | (EventBase & {
      readonly type: "InvoiceSent"
      readonly invoiceId: string
      readonly status: InvoiceStatus
    })
  | (EventBase & {
      readonly type: "PaymentConfirmed"
      readonly invoiceId: string
      readonly paymentIds: ReadonlyArray<string>
      readonly status: InvoiceStatus
    })
  | (EventBase & {
      readonly type: "InvoiceOverdue"
      readonly invoiceId: string
      readonly status: InvoiceStatus
    })
  | (EventBase & {
      readonly type: "ReminderSent"
      readonly invoiceId: string
      readonly status: InvoiceStatus
    })
  | (EventBase & {
      readonly type: "WorkflowFailed"
      readonly step: string
      readonly invoiceId?: string
      readonly detail: string
    })
