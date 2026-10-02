// Last line of defence for Prakasa AI data tools (program 4.1): a result that
// carries a price-, money-, payment- or contact/address-shaped KEY never leaves
// the server. The tools build their results from explicit field lists, so this
// only fires when someone adds a field by mistake — and then it fails closed.
const FORBIDDEN_KEY = /harga|price|nilai|value|amount|dpp|ppn|pajak|tax|diskon|disc|spend|belanja|biaya|cost|margin|payment|pembayaran|termin|currency|mata_uang|alamat|address|telepon|phone|email|npwp|ktp|rekening|bank/i;

function forbiddenKeys(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenKeys(item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) found.push(`${path}.${key}`);
      forbiddenKeys(child, `${path}.${key}`, found);
    }
  }
  return found;
}

function assertClean(value) {
  const found = forbiddenKeys(value);
  if (found.length) {
    throw Object.assign(new Error('Hasil alat berisi data yang tidak boleh dibaca Prakasa AI'), {
      status: 500, code: 'AI_OUTPUT_BLOCKED', paths: found.slice(0, 10),
    });
  }
  return value;
}

// Every agent tool (agentTools.js applies this to each result, whatever the
// module): personal data keys never leave the server; rupiah-shaped keys only
// from a tool declared `money: true` (which the contract forces to be
// privateOnly and behind the module's money permission).
const PERSONAL_KEY = /(^|_)(nik|npwp|ktp|kk|bpjs|gaji|salary|payroll|rekening|bank|password|kata_sandi|sandi|token|secret)($|_)/i;
const MONEY_KEY = /(^|_)(harga|price|nilai|amount|nominal|dpp|ppn|pajak|tax|diskon|spend|belanja|biaya|cost|margin|rupiah|rp|omzet|revenue|piutang|utang|saldo)($|_)/i;

function keysMatching(pattern, value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => keysMatching(pattern, item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      if (pattern.test(key)) found.push(`${path}.${key}`);
      keysMatching(pattern, child, `${path}.${key}`, found);
    }
  }
  return found;
}

function assertToolOutput(value, { money = false } = {}) {
  const found = [...keysMatching(PERSONAL_KEY, value), ...(money ? [] : keysMatching(MONEY_KEY, value))];
  if (found.length) {
    throw Object.assign(new Error('Hasil alat berisi data yang tidak boleh dibaca Prakasa AI'), {
      status: 500, code: 'AI_OUTPUT_BLOCKED', paths: found.slice(0, 10),
    });
  }
  return value;
}

module.exports = { FORBIDDEN_KEY, PERSONAL_KEY, MONEY_KEY, forbiddenKeys, assertClean, assertToolOutput };
