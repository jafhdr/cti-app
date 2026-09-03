import type { ReactNode } from 'react';

export type TableColumn<Row> = {
  readonly id: string;
  readonly name: ReactNode;
  readonly template: (row: Row) => ReactNode;
};

type TableProps<Row> = {
  readonly data: readonly Row[];
  readonly columns: readonly TableColumn<Row>[];
};

export function Table<Row>({ data, columns }: TableProps<Row>) {
  return <div className="cti-table-wrap" role="region" aria-label="Tabel data" tabIndex={0}><table className="cti-table"><thead><tr>{columns.map((column) => <th key={column.id} scope="col">{column.name}</th>)}</tr></thead><tbody>{data.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.id} data-label={column.name}>{column.template(row)}</td>)}</tr>)}</tbody></table></div>;
}
