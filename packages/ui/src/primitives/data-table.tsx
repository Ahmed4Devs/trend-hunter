'use client';

import {
  coreFeatures,
  createColumnHelper,
  createCoreRowModel,
  useTable,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';
import type * as React from 'react';

import { cn } from '../lib/cn';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

/**
 * The data grid.
 *
 * Only the core row model is registered. Every list in this product is paged,
 * filtered and sorted by PostgreSQL against the whole collection, so the client
 * holds one page at a time — enabling the client-side sorting or filtering
 * features would sort *that page*, which looks like it works and is wrong as
 * soon as there is a second page.
 *
 * Sorting is therefore reported outward and handled by the caller, which puts
 * it in the URL and asks the server again.
 */

const FEATURES = { ...coreFeatures, coreRowModel: createCoreRowModel() };

/**
 * The feature set every table in this product uses.
 *
 * Exported as a type so a caller can name it — `createColumnHelper` and
 * `ColumnDef` are both parameterised by it, and without a name for it every
 * call site would have to reach into this module's internals or cast.
 */
export type TableFeatureSet = typeof FEATURES;

/**
 * A column definition for a table built by `DataTable`.
 *
 * The value parameter is `any`, deliberately and exactly as the library's own
 * `columnHelper.columns()` declares it. `ColumnDef` is invariant in that
 * parameter, so a column over `string` is not assignable to a column over
 * `unknown`, and a table whose columns have different value types therefore has
 * no common element type to be an array of. Inference inside each column is
 * unaffected: `accessor` still infers its own value type at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export type TableColumn<TData extends RowData> = ColumnDef<TableFeatureSet, TData, any>;

/** Column helper bound to this table's feature set. */
export function columnHelperFor<TData extends RowData>() {
  return createColumnHelper<TableFeatureSet, TData>();
}

export interface DataTableProps<TData extends RowData> {
  readonly columns: readonly TableColumn<TData>[];
  readonly data: readonly TData[];
  /** Stable row identity, so React reuses rows across a page change. */
  readonly getRowId: (row: TData, index: number) => string;
  /** Rendered in place of the body when there are no rows. */
  readonly empty: React.ReactNode;
  readonly onRowClick?: (row: TData) => void;
  readonly className?: string;
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  empty,
  onRowClick,
  className,
}: DataTableProps<TData>) {
  const table = useTable({
    features: FEATURES,
    columns: [...columns],
    data: [...data],
    getRowId,
  });

  if (data.length === 0) return <>{empty}</>;

  return (
    <Table className={cn(className)}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            {...(onRowClick === undefined
              ? {}
              : {
                  onClick: () => {
                    onRowClick(row.original);
                  },
                  className: 'cursor-pointer',
                })}
          >
            {/* `getAllCells`, not `getVisibleCells`: column visibility is a
                feature this table does not register, and asking for it would
                be a runtime error rather than an empty column set. */}
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
