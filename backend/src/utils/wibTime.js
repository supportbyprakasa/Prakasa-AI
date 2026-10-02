// Prakasa's business day is WIB (Asia/Jakarta, UTC+7, no daylight saving),
// wherever the server runs. Database sessions run in UTC (db/connectionConfig.js),
// so code spells WIB out wherever it means a calendar day:
//   SQL "today":              DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
//   SQL day of a timestamp:   DATE(<column> + INTERVAL 7 HOUR)
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// A Date whose UTC fields read as the WIB wall clock; use its getUTC* methods.
const wibClock = (now = Date.now()) => new Date(Number(now) + WIB_OFFSET_MS);

// Today's date in WIB as YYYY-MM-DD (or the WIB date of any instant).
const todayWib = (now = Date.now()) => wibClock(now).toISOString().slice(0, 10);

module.exports = { WIB_OFFSET_MS, wibClock, todayWib };
