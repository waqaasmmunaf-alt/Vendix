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
  'ship to name': 'ship_to_name',
  'actual customer name incase forwarder': 'actual_customer_forwarder',
  'part no': 'part_no',
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
  'apple year': 'apple_year'
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
  'imei 1': 'imei1',
  'imei 2': 'imei2',
  'model': 'model',
  'description': 'description',
  'part number': 'part_no',
  'qty': 'qty',
  'pfi': 'proforma_invoice_no',
  'customer': 'customer_name',
  'sales date': 'date_of_shipment',
  'activationstatus': 'activation_status',
  'activation date': 'activated_date'
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
