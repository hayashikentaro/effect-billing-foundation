export interface Payment {
  readonly id: string
  readonly invoiceId: string
  readonly amount: number
  readonly paidAt: Date
  readonly method: "bank_transfer" | "card"
  readonly reference: string
}

export const totalPaidAmount = (payments: ReadonlyArray<Payment>) =>
  payments.reduce((total, payment) => total + payment.amount, 0)
