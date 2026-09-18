const { log } = require('../services/activityLog.service');

// Dipakai sebagai helper di controller (bukan middleware global) supaya
// metadata bisa diisi spesifik per resource.
module.exports = { log };
