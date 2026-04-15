import { Data } from "effect"

export class InputValidationError extends Data.TaggedError("InputValidationError")<{
  readonly source: string
  readonly detail: string
}> {}

export class RuleViolationError extends Data.TaggedError("RuleViolationError")<{
  readonly rule: string
  readonly detail: string
}> {}

export class EntityNotFoundError extends Data.TaggedError("EntityNotFoundError")<{
  readonly entity: string
  readonly id: string
}> {}

export class TenantBoundaryViolationError extends Data.TaggedError(
  "TenantBoundaryViolationError"
)<{
  readonly invoiceId: string
  readonly requestedTenantId: string
  readonly actualTenantId: string
  readonly step: string
  readonly detail: string
}> {}

export class InfrastructureError extends Data.TaggedError("InfrastructureError")<{
  readonly service: string
  readonly operation: string
  readonly detail: string
  readonly retryable: boolean
}> {}

export type AppError =
  | InputValidationError
  | RuleViolationError
  | EntityNotFoundError
  | TenantBoundaryViolationError
  | InfrastructureError

export const toInfrastructureError = (
  service: string,
  operation: string,
  detail: string,
  retryable = false
) =>
  new InfrastructureError({
    service,
    operation,
    detail,
    retryable
  })
