import ExcelJS from "exceljs";

export type SpreadsheetRow = Record<string, unknown>;
export type SpreadsheetSheet = {
  name: string;
  rows: SpreadsheetRow[];
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return value;
  if ("result" in value) return value.result ?? "";
  if ("text" in value) return value.text ?? "";
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  return String(value);
}

function safeSheetName(name: string, fallback: string) {
  return (
    (name || fallback)
      .replace(/[\\/*?:[\]]/g, " ")
      .trim()
      .slice(0, 31) || fallback
  );
}

export async function downloadWorkbook(filename: string, sheets: SpreadsheetSheet[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SocioHub";
  workbook.created = new Date();

  for (const [index, source] of sheets.entries()) {
    const worksheet = workbook.addWorksheet(safeSheetName(source.name, `Sheet ${index + 1}`));
    const headers = Array.from(new Set(source.rows.flatMap((row) => Object.keys(row))));

    if (headers.length === 0) continue;
    worksheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.min(
        40,
        Math.max(
          12,
          header.length + 2,
          ...source.rows.map((row) => String(row[header] ?? "").length + 2),
        ),
      ),
    }));
    for (const row of source.rows) worksheet.addRow(row);

    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = { from: "A1", to: `${worksheet.getColumn(headers.length).letter}1` };
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0047AB" },
    };
    headerRow.alignment = { vertical: "middle" };
    headerRow.height = 22;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function readFirstSheet(file: File): Promise<SpreadsheetRow[]> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error("Spreadsheet is too large. Maximum file size is 5 MB.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return parseCsv(await file.text());
  if (extension !== "xlsx") {
    throw new Error("Unsupported file type. Upload an .xlsx or .csv file.");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = String(cellValue(cell.value)).trim();
  });

  const rows: SpreadsheetRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const output: SpreadsheetRow = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = cellValue(row.getCell(index + 1).value);
      output[header] = value;
      if (String(value).trim()) hasValue = true;
    });
    if (hasValue) rows.push(output);
  });
  return rows;
}

function parseCsv(text: string): SpreadsheetRow[] {
  const matrix: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) matrix.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) matrix.push(row);

  const headers = (matrix.shift() ?? []).map((header) => header.trim());
  return matrix.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
  );
}
