import { Context, type Effect } from "effect"
import type { InfrastructureError } from "../domain/errors.js"
import type { Payment } from "../domain/payment.js"

/**
 * Hides PSP/bank API details, webhook formats, and reconciliation polling rules.
 * Common because payment confirmation stays the same even when the provider changes by tenant.
 */
export interface PaymentGatewayService {
  readonly recordPayment: (
    payment: Payment
  ) => Effect.Effect<void, InfrastructureError>
  readonly findPayments: (
    invoiceId: string
  ) => Effect.Effect<ReadonlyArray<Payment>, InfrastructureError>
}

export const PaymentGateway =
  Context.GenericTag<PaymentGatewayService>("PaymentGateway")
