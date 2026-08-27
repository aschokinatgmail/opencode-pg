/* oxlint-disable */
import { Column, getColumnTable } from "drizzle-orm/column"
import { CodecsCollection } from "drizzle-orm/codecs"
import { effectPgCodecs } from "drizzle-orm/effect-postgres/codecs"
import { is } from "drizzle-orm/entity"
import type { JoinNullability } from "drizzle-orm/query-builders/select.types"
import { resolvePgTypeAlias } from "drizzle-orm/pg-core/codecs"
import { Param, SQL } from "drizzle-orm/sql/sql"
import type { SelectedFieldsOrdered } from "drizzle-orm/pg-core/query-builders/select.types"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core/query-builders/update"
import type { PgTable } from "drizzle-orm/pg-core/table"
import { PgViewBase } from "drizzle-orm/pg-core/view-base"
import { Subquery } from "drizzle-orm/subquery"
import { Table, getTableName } from "drizzle-orm/table"
import type { UpdateSet } from "drizzle-orm/utils"
import { ViewBaseConfig } from "drizzle-orm/view-common"

const TableSymbol = (
  Table as unknown as {
    Symbol: { Columns: symbol; IsAlias: symbol; Name: symbol; BaseName: symbol }
  }
).Symbol

// FM-25 repair (Memo #12, B-A): restore RC2 codec parity. The vendored shims
// predate RC2's codec layer — bigint decode lives in the registry
// (`genericPgCodecs["bigint:number"].normalize = Number`), not in the column
// (`PgBigInt53` has no `mapFromDriverValue`). Construct the registry once from
// drizzle's own exports so every codec-bearing column class is fixed at the
// root. Acceptance: `pgCodecs.get(bigint({mode:"number"}) column, "normalize")
// === Number` (spiked against drizzle-orm@1.0.0-rc.2 exports map).
export const pgCodecs = new CodecsCollection(resolvePgTypeAlias, effectPgCodecs)

export function getTableColumnsRuntime(table: PgTable) {
  return (table as unknown as Record<symbol, Record<string, Column>>)[TableSymbol.Columns]
}

export function getViewSelectedFieldsRuntime(view: PgViewBase) {
  return (view as unknown as Record<symbol, { selectedFields: Record<string, unknown>; name: string }>)[ViewBaseConfig]
}

export function jitCompatCheck(isEnabled: boolean | undefined) {
  if (!isEnabled) return false
  try {
    return new Function("input", '"use strict"; return input;')(true) === true
  } catch {
    return false
  }
}

export function orderSelectedFields<TColumn extends Column>(
  fields: Record<string, unknown>,
  pathPrefix?: string[],
  codecs: CodecsCollection = pgCodecs,
): SelectedFieldsOrdered {
  return Object.entries(fields).flatMap(([name, field]) => {
    const path = pathPrefix ? [...pathPrefix, name] : [name]
    if (is(field, Column)) {
      const column = field as Column & { codec?: string; dimensions?: number }
      return [{
        path,
        field,
        codec: column.codec ? codecs.get(column, "normalize") : undefined,
        arrayDimensions: column.dimensions,
      }] as SelectedFieldsOrdered
    }
    if (is(field, SQL) || is(field, SQL.Aliased) || is(field, Subquery)) {
      return [{ path, field }] as SelectedFieldsOrdered
    }
    if (is(field, Table)) return orderSelectedFields(getTableColumnsRuntime(field as PgTable), path, codecs)
    return orderSelectedFields(field as Record<string, unknown>, path, codecs)
  }) as SelectedFieldsOrdered
}

export function mapUpdateSet<TTable extends PgTable>(table: TTable, values: PgUpdateSetSource<TTable>) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined)
  if (entries.length === 0) throw new Error("No values to set")

  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      is(value, SQL) || is(value, Column) ? value : new Param(value, getTableColumnsRuntime(table)[key]),
    ]),
  ) as UpdateSet
}

export function mapResultRow(
  columns: SelectedFieldsOrdered,
  row: unknown[],
  joinsNotNullableMap: Record<string, boolean> | undefined,
) {
  const nullifyMap: Record<string, string | false> = {}
  const result: Record<string, unknown> = {}

  columns.forEach((column, columnIndex) => {
    const decoder = (
      is(column.field, Column)
        ? column.field
        : is(column.field, SQL)
          ? (column.field as unknown as { decoder: { mapFromDriverValue(value: unknown): unknown } }).decoder
          : is(column.field, Subquery)
            ? (column.field._.sql as unknown as { decoder: { mapFromDriverValue(value: unknown): unknown } }).decoder
            : (column.field as unknown as { sql: { decoder: { mapFromDriverValue(value: unknown): unknown } } }).sql
              .decoder
    ) as {
      mapFromDriverValue(value: unknown): unknown
    }
    const rawValue = row[columnIndex]
    const codec = (column as { codec?: (value: unknown, arrayDimensions?: number) => unknown }).codec
    const arrayDimensions = (column as { arrayDimensions?: number }).arrayDimensions
    const value = rawValue === null ? null : decoder.mapFromDriverValue(codec ? codec(rawValue, arrayDimensions) : rawValue)
    const objectName = column.path[0]
    let node = result

    column.path.forEach((pathChunk, pathChunkIndex) => {
      if (pathChunkIndex === column.path.length - 1) {
        node[pathChunk] = value
        return
      }
      node[pathChunk] = (node[pathChunk] ?? {}) as Record<string, unknown>
      node = node[pathChunk] as Record<string, unknown>
    })

    if (joinsNotNullableMap && is(column.field, Column) && column.path.length === 2 && objectName) {
      const tableName = getTableName(getColumnTable(column.field))
      nullifyMap[objectName] =
        !(objectName in nullifyMap) && value === null
          ? tableName
          : typeof nullifyMap[objectName] === "string" && nullifyMap[objectName] !== tableName
            ? false
            : nullifyMap[objectName]
    }
  })

  Object.entries(nullifyMap).forEach(([objectName, tableName]) => {
    if (typeof tableName === "string" && !joinsNotNullableMap?.[tableName]) result[objectName] = null
  })

  return result
}

export function getTableLikeName(table: PgTable | Subquery | PgViewBase | SQL) {
  if (is(table, Subquery)) return table._.alias
  if (is(table, PgViewBase)) return getViewSelectedFieldsRuntime(table).name
  if (is(table, SQL)) return undefined
  return (table as unknown as Record<symbol, string | boolean>)[
    (table as unknown as Record<symbol, string | boolean>)[TableSymbol.IsAlias]
      ? TableSymbol.Name
      : TableSymbol.BaseName
  ] as string
}

export type { JoinNullability }