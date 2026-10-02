const { z } = require('zod');

// A sheet as the browser's read-excel-file hands it over: rows of cell values.
// Dates arrive as ISO strings in JSON. Limits keep one request small.
const cell = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);
const importMatrix = z.array(z.array(cell).max(80)).max(5000);

module.exports = { importMatrix };
