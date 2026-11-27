/**
 * Data export helpers (CSV and JSON). CSV cells are escaped per RFC 4180 and protected against
 * spreadsheet formula injection (cells beginning with =, +, -, @, tab or CR are prefixed with ').
 */
export const EXPORT_SCHEMA_VERSION = 1;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(rows: readonly T[], columns: readonly (keyof T & string)[]): string {
  const header = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: string;
  app: { name: 'Threshold'; version: string };
  notes: string[];
  data: Record<string, unknown>;
}

export function buildExportBundle(data: Record<string, unknown>, exportedAt: number, appVersion: string): ExportBundle {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    app: { name: 'Threshold', version: appVersion },
    notes: [
      'Timestamps are UTC epoch milliseconds; tzOffsetMin is the device offset when recorded.',
      'standardDrinks is null when alcohol content was unknown; such drinks are still listed.',
      'Health measurements are copies of samples read from Apple Health with their original timestamps.',
    ],
    data,
  };
}
