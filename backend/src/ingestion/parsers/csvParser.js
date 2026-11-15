// CSV parser. Every row becomes a small titled section ("row title" + "column: value"
// lines), so the title-based chunker can treat tables like any other document.
import { parse } from 'csv-parse/sync';

const TITLE_COLUMN = /^(name|title|disease|drug|medicine|medication|condition|topic|question|symptom|term|item|test|procedure)/i;
const isNumeric = (value) => value !== '' && !Number.isNaN(Number(value));

export function pickTitleColumn(columns, rows) {
  const named = columns.find((column) => TITLE_COLUMN.test(column));
  if (named) return named;
  const sample = rows.slice(0, 25);
  return columns.find((column) => sample.some((row) => row[column] && !isNumeric(row[column]))) || columns[0];
}

export function parseCsv(buffer) {
  const rows = parse(buffer, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  if (!rows.length) return { blocks: [], info: { rows: 0 } };

  const columns = Object.keys(rows[0]);
  const titleColumn = pickTitleColumn(columns, rows);
  const blocks = [
    { type: 'paragraph', text: `Table with ${rows.length} rows. Columns: ${columns.join(', ')}.` },
  ];

  rows.forEach((row, index) => {
    const title = (row[titleColumn] || '').toString().slice(0, 160) || `Row ${index + 1}`;
    const lines = columns
      .filter((column) => row[column] !== undefined && row[column] !== '')
      .map((column) => `${column}: ${row[column]}`);
    if (!lines.length) return;
    blocks.push({ type: 'heading', text: title, level: 1, style: 'csv-row', row: index + 1 });
    blocks.push({ type: 'paragraph', text: lines.join('\n'), row: index + 1 });
  });
  return { blocks, info: { rows: rows.length, columns, titleColumn } };
}
