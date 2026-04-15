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
