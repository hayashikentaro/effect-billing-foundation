import { Effect } from "effect"
import { InputValidationError } from "../../domain/errors.js"

const splitCsvLine = (line: string): ReadonlyArray<string> => {
  const cells: Array<string> = []
  let current = ""
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim())
      current = ""
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

export const parseCsv = (
  csvText: string
): Effect.Effect<ReadonlyArray<Readonly<Record<string, string>>>, InputValidationError> =>
  Effect.try({
    try: () => {
      const lines = csvText
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (lines.length < 2) {
        throw new Error("CSV must include a header and at least one data row")
      }

      const headers = splitCsvLine(lines[0])

      return lines.slice(1).map((line, index) => {
        const values = splitCsvLine(line)

        if (values.length !== headers.length) {
          throw new Error(
            `Row ${index + 2} has ${values.length} cells but header has ${headers.length}`
          )
        }

        return headers.reduce<Record<string, string>>((record, header, headerIndex) => {
          record[header] = values[headerIndex] ?? ""
          return record
        }, {})
      })
    },
    catch: (error) =>
      new InputValidationError({
        source: "csv",
        detail: error instanceof Error ? error.message : "Failed to parse CSV"
      })
  })
