// Procurement quantities, dates and states (program 4.1). The tools themselves
// live in ../supplyTools.js with their owner rules (never a price, PO value,
// vendor spend or contact; private conversations only); this file only says
// which pages they serve.
const { TOOLS } = require('../supplyTools');

const NAMES = ['status_po', 'procurement_hari_ini', 'rapor_pemasok'];

module.exports = TOOLS.filter((tool) => NAMES.includes(tool.name)).map((tool) => ({ ...tool, module: ['procurement'] }));
