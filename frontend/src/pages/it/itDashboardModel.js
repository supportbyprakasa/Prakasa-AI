// The IT dashboard's bar lists (rule 22): devices per status, per type and
// per location, each line linking to the device list with that filter. Pure.
import { formatNumber } from '../../components/format.js';
import { DEVICE_STATUS_LABELS, DEVICE_TYPE_LABELS, MAIN_DEVICE_STATUSES, OTHER_DEVICE_STATUSES } from './itModel.js';

const n = (value) => Number(value) || 0;

export function dashboardBars(data) {
  const devices = data?.devices || {};
  const byStatus = devices.byStatus || {};
  const labels = { ...DEVICE_STATUS_LABELS, ...(devices.statusLabels || {}) };
  const hasDevices = n(devices.total) > 0;
  // The report's four statuses always (when there are devices), the others
  // only when they hold something.
  const statuses = hasDevices
    ? [...MAIN_DEVICE_STATUSES, ...OTHER_DEVICE_STATUSES.filter((s) => n(byStatus[s]) > 0)]
    : [];
  return {
    byStatus: statuses.map((status) => ({
      key: status, label: labels[status] || status, value: n(byStatus[status]), to: `/it/devices?status=${status}`,
    })),
    byType: (data?.byType || [])
      .filter((row) => n(row.total) > 0)
      .map((row) => ({
        key: row.deviceType, label: DEVICE_TYPE_LABELS[row.deviceType] || row.label || row.deviceType, data: !DEVICE_TYPE_LABELS[row.deviceType], value: n(row.total), to: `/it/devices?type=${row.deviceType}`,
      }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'id')),
    byLocation: (data?.byLocation || [])
      .filter((row) => n(row.total) > 0)
      .map((row) => ({
        key: row.locationId ?? 'none',
        label: row.name || 'Tanpa lokasi',
        // A location's name is record data: never translated.
        data: Boolean(row.name) && row.locationId !== null && row.locationId !== undefined,
        value: n(row.total),
        note: n(row.problematic) ? `${formatNumber(n(row.problematic))} bermasalah` : '',
        to: `/it/devices?location=${row.locationId ?? 'none'}`,
      }))
      .sort((a, b) => b.value - a.value),
  };
}
