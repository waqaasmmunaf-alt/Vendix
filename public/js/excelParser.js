// Requires SheetJS (xlsx) loaded via CDN before this script.

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const OPS_HEADER_MAP = {
  'location': 'location',
  'date of shipment': 'date_of_shipment',
  'apple week': 'apple_week',
  'month': 'month',
  'order reference no': 'order_reference_no',
  'proforma invoice no': 'proforma_invoice_no',
  'bill to customer name': 'customer_name',
  'customer name': 'customer_name',
  'customer': 'customer_name',
  'ship to name': 'ship_to_name',
  'actual customer name incase forwarder': 'actual_customer_forwarder',
  'part no': 'part_no',
  'part number': 'part_no',
  'description': 'description',
  'color': 'color',
  'gb': 'gb',
  'lob': 'lob',
  'sub lob': 'sub_lob',
  'qty': 'qty',
  'carton no': 'carton_no',
  'serial no': 'serial_no',
  'imei 1': 'imei1',
  'imei 2': 'imei2',
  'apple qtr': 'apple_qtr',
  'apple year': 'apple_year',
  'rtm category': 'rtm_category_text',
  'rtm': 'rtm_category_text'
};

const ACTIVATION_HEADER_MAP = {
  'serial': 'serial_fallback',
  'imei 1': 'imei1',
  'serial number': 'serial_no',
  'device model': 'device_model',
  'activated status': 'activated_status',
  'remaining warranty': 'remaining_warranty',
  'purchase date': 'purchase_date',
  'activated date': 'activated_date',
  'warranty expiration date': 'warranty_expiration_date'
};

const COMBINED_HEADER_MAP = {
  'serial': 'serial_no',
  'serial no': 'serial_no',
  'imei 1': 'imei1',
  'imei 2': 'imei2',
  'model': 'model',
  'description': 'description',
  'part number': 'part_no',
  'part no': 'part_no',
  'qty': 'qty',
  'pfi': 'proforma_invoice_no',
  'pfi no': 'proforma_invoice_no',
  'customer': 'customer_name',
  'customer name': 'customer_name',
  'sales date': 'date_of_shipment',
  'activationstatus': 'activation_status',
  'activation status': 'activation_status',
  'activation date': 'activated_date',
  'rtm category': 'rtm_category_text',
  'rtm': 'rtm_category_text'
};

const SHIPMENT_PLAN_HEADER_MAP = {
  'lob': 'lob',
  'sub lob': 'sub_lob',
  'model': 'model',
  'storage': 'storage',
  'gb': 'storage',
  'color': 'color',
  'customer': 'customer_name',
  'customer name': 'customer_name',
  'bill to customer name': 'customer_name',
  'location': 'location',
  'rtm': 'location',
  'week': 'plan_week_date',
  'plan week': 'plan_week_date',
  'week start': 'plan_week_date',
  'ship week': 'plan_week_date',
  'planned qty': 'planned_qty',
  'plan qty': 'planned_qty',
  'shipment qty': 'planned_qty',
  'qty': 'planned_qty',
  'fgos': 'fgos_qty',
  'backlog': 'backlog_qty'
};

const PO_ORDER_HEADER_MAP = {
  'serial number': 'serial_no',
  'imei1': 'imei1',
  'imei2': 'imei2',
  'ship date': 'date_of_shipment',
  'month': 'month',
  'order ref no': 'order_reference_no',
  'company name': 'customer_name',
  'desc': 'description',
  'model': 'model',
  'part number': 'part_no',
  'storage': 'gb',
  'color': 'color'
};

function buildFieldMap(headerRow, headerMap) {
  const map = {};
  headerRow.forEach((raw, idx) => {
    const norm = normalizeHeader(raw);
    if (headerMap[norm]) map[headerMap[norm]] = idx;
  });
  return map;
}

function toDateString(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const parts = String(value).trim().split(/[-/]/);
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  // "DD.MM.YYYY" (dot-separated, used by the Shipment Plan file's week-ending
  // headers) — parsed explicitly since JS's Date constructor guesses
  // MM.DD.YYYY for this format and silently gives the wrong date.
  const dotParts = String(value).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotParts) {
    const [, dd, mm, yyyy] = dotParts;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function cleanImei(value) {
  if (value === null || value === undefined || value === '') return null;
  let str = typeof value === 'number' ? value.toFixed(0) : String(value).trim();
  str = str.replace(/\D/g, '');
  return str.length >= 14 ? str : null;
}

// Parses the ops export file. Skips "Sheet1" (redundant rollup tab), filters to LOB = iPhone.
async function parseOpsExportFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const rows = [];
  const warnings = [];

  for (const sheetName of workbook.SheetNames) {
    if (sheetName.trim().toLowerCase() === 'sheet1') {
      warnings.push(`Sheet "${sheetName}" skipped — treated as a rollup/summary tab, not a distinct location.`);
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (data.length === 0) continue;

    const fieldMap = buildFieldMap(data[0], OPS_HEADER_MAP);
    if (fieldMap.imei1 === undefined) {
      warnings.push(`Sheet "${sheetName}" skipped — no IMEI 1 column found.`);
      continue;
    }

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => c === null || c === '')) continue;
      const get = (field) => (fieldMap[field] !== undefined ? row[fieldMap[field]] : null);

      const imei1 = cleanImei(get('imei1'));
      if (!imei1) continue;

      const lob = get('lob');
      if (lob && String(lob).trim().toLowerCase() !== 'iphone') continue;

      rows.push({
        imei1,
        imei2: cleanImei(get('imei2')),
        serial_no: get('serial_no') || null,
        location: get('location') || sheetName,
        date_of_shipment: toDateString(get('date_of_shipment')),
        month: get('month') || null,
        order_reference_no: get('order_reference_no') || null,
        proforma_invoice_no: get('proforma_invoice_no') || null,
        customer_name: (get('customer_name') || '').toString().trim() || 'Unknown Customer',
        rtm_category_text: (get('rtm_category_text') || '').toString().trim() || null,
        ship_to_name: get('ship_to_name') || null,
        actual_customer_forwarder: get('actual_customer_forwarder') || null,
        part_no: get('part_no') || null,
        description: get('description') || null,
        color: get('color') || null,
        gb: get('gb') || null,
        lob: lob || 'iPhone',
        sub_lob: get('sub_lob') || null,
        qty: get('qty') || 1,
        carton_no: get('carton_no') || null,
        apple_week: get('apple_week') || null,
        apple_qtr: get('apple_qtr') || null,
        apple_year: get('apple_year') || null
      });
    }
  }

  return { rows, warnings };
}

// Parses the activation check result file. Returns only rows with status = 'activated'
// (per business rule: "Not Activated" and other statuses like 已过期 are ignored).
async function parseActivationCheckFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const activatedRows = [];
  let totalRows = 0;
  const warnings = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (data.length === 0) continue;

    const fieldMap = buildFieldMap(data[0], ACTIVATION_HEADER_MAP);
    if (fieldMap.imei1 === undefined || fieldMap.activated_status === undefined) {
      warnings.push(`Sheet "${sheetName}" skipped — missing IMEI 1 or Activated Status column.`);
      continue;
    }

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => c === null || c === '')) continue;
      const get = (field) => (fieldMap[field] !== undefined ? row[fieldMap[field]] : null);

      const imei1 = cleanImei(get('imei1'));
      if (!imei1) continue;
      totalRows++;

      const rawStatus = String(get('activated_status') || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (rawStatus === 'activated') {
        activatedRows.push({
          imei1,
          activated_date: toDateString(get('activated_date')),
          device_model: get('device_model') || null
        });
      }
      // "not activated" and anything else (e.g. 已过期) are ignored per business rule
    }
  }

  return { activatedRows, totalRows, warnings };
}

// Parses a "combined report" file — one row per unit with BOTH sales and
// activation data already merged (e.g. AF/regional customer reports).
// Apple Week/Qtr/Year are always derived from the calendar by actual date,
// never trusted from the file's own text columns (formats vary file to file).
async function parseCombinedReportFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const rows = [];
  const warnings = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (data.length === 0) continue;

    const fieldMap = buildFieldMap(data[0], COMBINED_HEADER_MAP);
    if (fieldMap.imei1 === undefined) {
      warnings.push(`Sheet "${sheetName}" skipped — no IMEI 1 column found.`);
      continue;
    }

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => c === null || c === '')) continue;
      const get = (field) => (fieldMap[field] !== undefined ? row[fieldMap[field]] : null);

      const imei1 = cleanImei(get('imei1'));
      if (!imei1) continue;

      const rawStatus = String(get('activation_status') || '').replace(/\s+/g, ' ').trim();
      const normalized = rawStatus.toLowerCase();

      let status;
      if (normalized === 'activated') status = 'activated';
      else if (normalized === 'not activated') status = 'unactivated';
      else if (normalized.includes('not included')) status = 'not_included';
      else status = 'unactivated'; // unrecognized text — safe fallback, kept visible via remark below

      // Keep the raw text as a remark whenever it isn't one of the two plain standard values,
      // so nothing is silently discarded even for future unexpected status text.
      const remark = (normalized === 'activated' || normalized === 'not activated' || normalized === '')
        ? null
        : rawStatus;

      rows.push({
        imei1,
        imei2: cleanImei(get('imei2')),
        serial_no: get('serial_no') || null,
        model: get('model') || null,
        description: get('description') || null,
        part_no: get('part_no') || null,
        qty: get('qty') || 1,
        proforma_invoice_no: get('proforma_invoice_no') || null,
        customer_name: (get('customer_name') || '').toString().trim() || 'Unknown Customer',
        rtm_category_text: (get('rtm_category_text') || '').toString().trim() || null,
        date_of_shipment: toDateString(get('date_of_shipment')),
        status,
        activated_date: status === 'activated' ? toDateString(get('activated_date')) : null,
        activation_remark: remark
      });
    }
  }

  return { rows, warnings };
}

// Parses the "PK order with line items" sales file — mixed iPhone/MacBook
// data, filtered here to iPhone only. Sales-only (no activation data).
async function parsePkOrderFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const rows = [];
  const warnings = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (data.length === 0) continue;

    const fieldMap = buildFieldMap(data[0], PO_ORDER_HEADER_MAP);
    if (fieldMap.imei1 === undefined) {
      warnings.push(`Sheet "${sheetName}" skipped — no IMEI1 column found.`);
      continue;
    }

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => c === null || c === '')) continue;
      const get = (field) => (fieldMap[field] !== undefined ? row[fieldMap[field]] : null);

      const imei1 = cleanImei(get('imei1'));
      if (!imei1) continue;

      const model = (get('model') || '').toString().trim();
      if (!model.toLowerCase().startsWith('iphone')) continue; // iPhone only, per scope

      rows.push({
        imei1,
        imei2: cleanImei(get('imei2')),
        serial_no: get('serial_no') || null,
        date_of_shipment: toDateString(get('date_of_shipment')),
        month: get('month') || null,
        order_reference_no: get('order_reference_no') || null,
        customer_name: (get('customer_name') || '').toString().trim() || 'Unknown Customer',
        description: get('description') || null,
        model,
        part_no: get('part_no') || null,
        gb: get('gb') || null,
        color: get('color') || null,
        qty: 1
      });
    }
  }

  return { rows, warnings };
}

// Parses a "Shipment Plan" file — planning-level rows (NOT per-IMEI): one
// row per Model/Storage/Color/Location/Week line with a planned quantity,
// feeding the PSI Report's Shipment Plan WK-1/2/3, Backlog and FGOS columns.
async function parseShipmentPlanFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const rows = [];
  const warnings = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (data.length === 0) continue;

    const fieldMap = buildFieldMap(data[0], SHIPMENT_PLAN_HEADER_MAP);
    if (fieldMap.model === undefined) {
      warnings.push(`Sheet "${sheetName}" skipped — no Model column found.`);
      continue;
    }

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every((c) => c === null || c === '')) continue;
      const get = (field) => (fieldMap[field] !== undefined ? row[fieldMap[field]] : null);

      const model = (get('model') || '').toString().trim();
      if (!model) continue;

      const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : 0;
      };

      rows.push({
        lob: get('lob') || 'iPhone',
        sub_lob: get('sub_lob') || null,
        model,
        storage: get('storage') || null,
        color: get('color') || null,
        customer_name: (get('customer_name') || '').toString().trim() || null,
        location: get('location') || null,
        plan_week_date: toDateString(get('plan_week_date')),
        planned_qty: toInt(get('planned_qty')),
        fgos_qty: toInt(get('fgos_qty')),
        backlog_qty: toInt(get('backlog_qty'))
      });
    }
  }

  return { rows, warnings };
}

// ============================================================
// PSI v2 parsers — read the REAL business workbooks directly:
//   • Sales ledger      ("Sales till <date>" style sheet)
//   • Purchase ledger   ("Purchases till <date>" style sheet)
//   • Inventory snapshot ("CONSOLIDATED with Value" style sheet)
//   • Shipment plan      ("Shipment plan" sheet, dynamic weekly columns)
//
// These workbooks routinely have 20-60+ unrelated pivot/working tabs, and
// the one tab that matters is often named with a date that changes every
// upload (e.g. "Sales till 8th Aug 2026"). So instead of matching sheet
// names, every parser here SCANS every sheet's first ~15 rows for the row
// that best matches a set of expected column headers, and uses whichever
// sheet+row scores highest. This keeps working next month without any
// hardcoded sheet name.
// ============================================================

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

// Scans every sheet's first `maxScanRows` rows for the row that best matches
// `headerTokens` (normalized). Returns the best {sheetName, data, headerRowIndex,
// score} across the whole workbook, or null if nothing scores >= minMatches.
function findBestSheetAndHeaderRow(workbook, headerTokens, minMatches, maxScanRows = 15) {
  let best = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (!data.length) continue;

    const scanLimit = Math.min(data.length, maxScanRows);
    for (let r = 0; r < scanLimit; r++) {
      const row = data[r];
      if (!row) continue;
      const normSet = new Set(row.map((c) => normalizeHeader(c)).filter(Boolean));
      let score = 0;
      for (const token of headerTokens) {
        if (normSet.has(token)) score++;
      }
      if (score >= minMatches && (!best || score > best.score)) {
        best = { sheetName, data, headerRowIndex: r, score };
      }
    }
  }

  return best;
}

function findColumnIndex(headerRow, normalizedTarget) {
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeHeader(headerRow[i]) === normalizedTarget) return i;
  }
  return -1;
}

function findAllColumnIndices(headerRow, normalizedTarget) {
  const out = [];
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeHeader(headerRow[i]) === normalizedTarget) out.push(i);
  }
  return out;
}

// ---- Sales ledger ----
const SALES_LEDGER_TOKENS = [
  'part no', 'lob', 'date', 'document number', 'qty', 'revenue', 'sale price',
  'customer name', 'apple qtr', 'apple year', 'cost', 'description'
];

async function parseSalesLedgerFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const warnings = [];

  const best = findBestSheetAndHeaderRow(workbook, SALES_LEDGER_TOKENS, 6);
  if (!best) {
    return { rows: [], warnings: ['Could not find a sales ledger sheet — no tab had columns matching Part No / LOB / Date / Document Number / Qty / Revenue.'] };
  }

  const { sheetName, data, headerRowIndex } = best;
  const headerRow = data[headerRowIndex];
  const idx = {
    partNo: findColumnIndex(headerRow, 'part no'),
    lob: findColumnIndex(headerRow, 'lob'),
    subLob: (() => { const i = findColumnIndex(headerRow, 'sub lob'); return i >= 0 ? i : findColumnIndex(headerRow, 'sub category'); })(),
    description: findColumnIndex(headerRow, 'description'),
    date: findColumnIndex(headerRow, 'date'),
    documentNumber: findColumnIndex(headerRow, 'document number'),
    qty: findColumnIndex(headerRow, 'qty'),
    cost: findColumnIndex(headerRow, 'cost'),
    salePrice: findColumnIndex(headerRow, 'sale price'),
    revenue: findColumnIndex(headerRow, 'revenue'),
    customerName: findColumnIndex(headerRow, 'customer name'),
    salesPerson: findColumnIndex(headerRow, 'sales person'),
    appleYear: findColumnIndex(headerRow, 'apple year'),
    appleQtr: findColumnIndex(headerRow, 'apple qtr'),
    appleWeek: (() => { const i = findColumnIndex(headerRow, 'apple wk'); return i >= 0 ? i : findColumnIndex(headerRow, 'apple week'); })()
  };

  const rows = [];
  for (let r = headerRowIndex + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.every((c) => c === null || c === '')) continue;
    const get = (i) => (i >= 0 ? row[i] : null);

    const partNo = get(idx.partNo);
    const documentNumber = get(idx.documentNumber);
    if (!partNo || !documentNumber) continue; // both are required for the dedup key server-side

    rows.push({
      partNo: String(partNo).trim(),
      lob: (get(idx.lob) || '').toString().trim() || null,
      subLob: (get(idx.subLob) || '').toString().trim() || null,
      description: get(idx.description) || null,
      saleDate: toDateString(get(idx.date)),
      appleYear: get(idx.appleYear) != null ? String(get(idx.appleYear)) : null,
      appleQtr: get(idx.appleQtr) || null,
      appleWeek: get(idx.appleWeek) || null,
      documentNumber: String(documentNumber).trim(),
      qty: toNumber(get(idx.qty)),
      cost: toNumber(get(idx.cost)),
      salePrice: toNumber(get(idx.salePrice)),
      revenue: toNumber(get(idx.revenue)),
      customerName: (get(idx.customerName) || '').toString().trim() || null,
      salesPerson: (get(idx.salesPerson) || '').toString().trim() || null
    });
  }

  if (idx.partNo < 0 || idx.documentNumber < 0) {
    warnings.push(`Sheet "${sheetName}" matched but is missing a Part No or Document Number column — check the file format.`);
  }
  warnings.push(`Read from sheet "${sheetName}" (row ${headerRowIndex + 1} as header) — ${rows.length} sales lines.`);

  return { rows, warnings };
}

// ---- Purchase ledger ----
const PURCHASE_LEDGER_TOKENS = [
  'part no', 'date', 'document number', 'qty', 'amount', 'price', 'category',
  'sub lob', 'apple qtr', 'apple year', 'description'
];

async function parsePurchaseLedgerFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const warnings = [];

  const best = findBestSheetAndHeaderRow(workbook, PURCHASE_LEDGER_TOKENS, 6);
  if (!best) {
    return { rows: [], warnings: ['Could not find a purchase ledger sheet — no tab had columns matching Part No / Date / Document Number / Qty / Amount.'] };
  }

  const { sheetName, data, headerRowIndex } = best;
  const headerRow = data[headerRowIndex];
  const idx = {
    partNo: findColumnIndex(headerRow, 'part no'),
    lob: (() => { const i = findColumnIndex(headerRow, 'category'); return i >= 0 ? i : findColumnIndex(headerRow, 'lob'); })(),
    subLob: findColumnIndex(headerRow, 'sub lob'),
    description: findColumnIndex(headerRow, 'description'),
    date: findColumnIndex(headerRow, 'date'),
    documentNumber: findColumnIndex(headerRow, 'document number'),
    qty: findColumnIndex(headerRow, 'qty'),
    price: findColumnIndex(headerRow, 'price'),
    amount: findColumnIndex(headerRow, 'amount'),
    vendor: findColumnIndex(headerRow, 'billing addressee'),
    appleYear: findColumnIndex(headerRow, 'apple year'),
    appleQtr: findColumnIndex(headerRow, 'apple qtr'),
    appleWeek: (() => { const i = findColumnIndex(headerRow, 'week apple'); return i >= 0 ? i : findColumnIndex(headerRow, 'apple week'); })()
  };

  const rows = [];
  for (let r = headerRowIndex + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.every((c) => c === null || c === '')) continue;
    const get = (i) => (i >= 0 ? row[i] : null);

    const partNo = get(idx.partNo);
    const documentNumber = get(idx.documentNumber);
    if (!partNo || !documentNumber) continue;

    rows.push({
      partNo: String(partNo).trim(),
      lob: (get(idx.lob) || '').toString().trim() || null,
      subLob: (get(idx.subLob) || '').toString().trim() || null,
      description: get(idx.description) || null,
      purchaseDate: toDateString(get(idx.date)),
      appleYear: get(idx.appleYear) != null ? String(get(idx.appleYear)) : null,
      appleQtr: get(idx.appleQtr) || null,
      appleWeek: get(idx.appleWeek) || null,
      documentNumber: String(documentNumber).trim(),
      qty: toNumber(get(idx.qty)),
      price: toNumber(get(idx.price)),
      amount: toNumber(get(idx.amount)),
      vendor: (get(idx.vendor) || '').toString().trim() || null
    });
  }

  if (idx.partNo < 0 || idx.documentNumber < 0) {
    warnings.push(`Sheet "${sheetName}" matched but is missing a Part No or Document Number column — check the file format.`);
  }
  warnings.push(`Read from sheet "${sheetName}" (row ${headerRowIndex + 1} as header) — ${rows.length} purchase lines.`);

  return { rows, warnings };
}

// ---- Inventory snapshot ----
// Wide format: one row per Part No with separate Qty/Value column PAIRS per
// warehouse. Each pair becomes its own output row (Part No x Location).
const INVENTORY_TOKENS = [
  'part no', 'lob', 'sub lob', 'description', 'sg qty', 'sg value', 'total qty', 'total value'
];
const INVENTORY_LOCATION_PAIRS = [
  { qty: 'sg qty', value: 'sg value', location: 'SG' },
  { qty: 'dafza qty', value: 'dafza value', location: 'Dafza' },
  { qty: 'dcc qty', value: 'dcc value', location: 'DCC' },
  { qty: 'dubai leading qty', value: 'dubai leading value', location: 'Dubai Leading' },
  { qty: 'dubai qty', value: 'dubai value', location: 'Dubai' },
  { qty: 'hk qty', value: 'hk value', location: 'HK' },
  { qty: 'pk it qty', value: 'pk it value', location: 'PK IT' },
  { qty: 'pk qty', value: 'pk value', location: 'PK' }
];

async function parseInventorySnapshotFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const warnings = [];

  const best = findBestSheetAndHeaderRow(workbook, INVENTORY_TOKENS, 5);
  if (!best) {
    return { rows: [], warnings: ['Could not find an inventory snapshot sheet — no tab had columns matching Part No / LOB / SG Qty / Total Qty (expected the "CONSOLIDATED with Value" style sheet).'] };
  }

  const { sheetName, data, headerRowIndex } = best;
  const headerRow = data[headerRowIndex];

  const idx = {
    partNo: findColumnIndex(headerRow, 'part no'),
    lob: findColumnIndex(headerRow, 'lob'),
    subLob: findColumnIndex(headerRow, 'sub lob'),
    description: findColumnIndex(headerRow, 'description')
  };

  const locationCols = INVENTORY_LOCATION_PAIRS.map((p) => ({
    location: p.location,
    qtyIdx: findColumnIndex(headerRow, p.qty),
    valueIdx: findColumnIndex(headerRow, p.value)
  })).filter((c) => c.qtyIdx >= 0);

  // Snapshot date: look for a standalone date value in the first couple of
  // rows above the header (these sheets usually print the "as of" date there).
  let snapshotDate = null;
  for (let r = 0; r < headerRowIndex; r++) {
    for (const cell of data[r] || []) {
      const d = toDateString(cell);
      if (d) { snapshotDate = d; break; }
    }
    if (snapshotDate) break;
  }

  const rows = [];
  for (let r = headerRowIndex + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.every((c) => c === null || c === '')) continue;
    const get = (i) => (i >= 0 ? row[i] : null);

    const partNo = get(idx.partNo);
    if (!partNo) continue;

    const lob = (get(idx.lob) || '').toString().trim() || null;
    const subLob = (get(idx.subLob) || '').toString().trim() || null;
    const description = get(idx.description) || null;

    for (const col of locationCols) {
      const qty = toNumber(get(col.qtyIdx));
      if (!qty) continue; // skip zero/blank location rows — keeps the table lean
      rows.push({
        snapshotDate,
        partNo: String(partNo).trim(),
        lob, subLob, description,
        location: col.location,
        qty,
        value: toNumber(get(col.valueIdx))
      });
    }
  }

  warnings.push(`Read from sheet "${sheetName}" (row ${headerRowIndex + 1} as header) — ${rows.length} part/location lines across ${locationCols.length} warehouse columns.`);
  return { rows, warnings };
}

// ---- Shipment plan (dynamic weekly columns) ----
const SHIPMENT_PLAN_V2_TOKENS = [
  'product category', 'model', 'apple part', 'description', 'shipment plan',
  'total backlog', 'rollover qty'
];

async function parseShipmentPlanFileV2(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const warnings = [];

  const best = findBestSheetAndHeaderRow(workbook, SHIPMENT_PLAN_V2_TOKENS, 4);
  if (!best) {
    return { rows: [], warnings: ['Could not find a shipment plan sheet — no tab had columns matching Product Category / Model / Apple Part# / Shipment Plan / Total Backlog.'] };
  }

  const { sheetName, data, headerRowIndex } = best;
  const headerRow = data[headerRowIndex];

  const idx = {
    productCategory: findColumnIndex(headerRow, 'product category'),
    model: findColumnIndex(headerRow, 'model'),
    partNo: (() => { const i = findColumnIndex(headerRow, 'apple part'); return i >= 0 ? i : findColumnIndex(headerRow, 'apple part#'); })(),
    description: findColumnIndex(headerRow, 'description'),
    totalBacklog: findColumnIndex(headerRow, 'total backlog'),
    rolloverQty: findColumnIndex(headerRow, 'rollover qty')
  };

  // The individual weekly "Shipment Plan" columns repeat the same header
  // text once per week — find every occurrence, in column order.
  const weekCols = findAllColumnIndices(headerRow, 'shipment plan');

  // Week labels/dates live a few rows ABOVE the header row, at the SAME
  // column index as each week's "Shipment Plan" column. Find which row (if
  // any) above the header holds "Apple Fiscal Week" / "Week Ending" labels.
  let labelRowIndex = -1;
  let endingRowIndex = -1;
  for (let r = Math.max(0, headerRowIndex - 6); r < headerRowIndex; r++) {
    const row = data[r] || [];
    if (row.some((c) => normalizeHeader(c) === 'apple fiscal week')) labelRowIndex = r;
    if (row.some((c) => normalizeHeader(c) === 'week ending')) endingRowIndex = r;
  }

  const rows = [];
  for (let r = headerRowIndex + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.every((c) => c === null || c === '')) continue;
    const get = (i) => (i >= 0 ? row[i] : null);

    const partNo = get(idx.partNo);
    const model = get(idx.model);
    if (!partNo && !model) continue;

    const weeks = weekCols.map((colIdx, i) => ({
      weekIndex: i + 1,
      weekLabel: labelRowIndex >= 0 ? (data[labelRowIndex][colIdx] || null) : null,
      weekEnding: endingRowIndex >= 0 ? toDateString(data[endingRowIndex][colIdx]) : null,
      plannedQty: toNumber(get(colIdx))
    }));

    rows.push({
      productCategory: (get(idx.productCategory) || '').toString().trim() || null,
      model: (model || '').toString().trim() || null,
      partNo: (partNo || '').toString().trim() || null,
      description: get(idx.description) || null,
      totalBacklog: toNumber(get(idx.totalBacklog)),
      rolloverQty: toNumber(get(idx.rolloverQty)),
      weeks
    });
  }

  warnings.push(`Read from sheet "${sheetName}" (row ${headerRowIndex + 1} as header) — ${rows.length} SKU rows, ${weekCols.length} weekly columns detected.`);
  return { rows, warnings };
}
