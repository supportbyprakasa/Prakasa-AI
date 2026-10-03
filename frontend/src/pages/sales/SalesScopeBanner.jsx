import { useEffect, useState } from 'react';
import api from '../../api/client';
import Banner from '../../components/Banner';
import { NoTranslate } from '../../i18n/NoTranslate';

// The caller's Sales scope, shared by every Sales page: whether they see all
// data or only their own, which salesperson names map to them, and where
// transactions are recorded (Accurate or this app). Cached per session token,
// so signing in as someone else never shows the old scope.
let cached = { token: null, scope: null };
const currentToken = () => { try { return localStorage.getItem('prakasa.token'); } catch { return null; } };

export function resetSalesScope() { cached = { token: null, scope: null }; }

export function useSalesScope() {
  const token = currentToken();
  const [scope, setScope] = useState(cached.token === token ? cached.scope : null);
  useEffect(() => {
    if (cached.token === token && cached.scope) return;
    api.get('/sales/scope').then((r) => { cached = { token, scope: r.data.data }; setScope(r.data.data); }).catch(() => {});
  }, [token]);
  return scope;
}

// True while transactions live in Accurate — also before the scope has loaded,
// so input buttons never flash on and then vanish.
export function useAccurateSource() {
  const scope = useSalesScope();
  return (scope?.transactionSource ?? 'accurate') !== 'app';
}

// True once the Sales numbers read approved Accurate invoices (Tahap B):
// revenue from invoices, Accurate SOs and invoices in Data Sales.
export function useNumbersFromAccurate() {
  const scope = useSalesScope();
  return scope?.numbersSource === 'accurate';
}

// False only once the scope says so: until Accurate data has arrived, the
// transaction figures are the old, incomplete sheet recap. Owner's decision
// (2026-09-29): mark them, and hold the alarms built on them.
export function useTransactionsReliable() {
  const scope = useSalesScope();
  return scope?.transactionsReliable !== false;
}

export function AccurateHoldBanner() {
  if (useTransactionsReliable()) return null;
  return (
    <Banner tone="warning" title="Belum tersambung ke Accurate, angka transaksi belum lengkap">
      Sales order, omzet, surat jalan, invoice dan piutang di sini masih data lama dari rekap, jadi belum cocok dengan
      pembukuan. Pengingat dormant dan tagihan ditahan dulu, dan akan aktif sendiri setelah data Accurate masuk.
    </Banner>
  );
}

export default function SalesScopeBanner() {
  const scope = useSalesScope();
  if (!scope || scope.viewAll) return null;
  const names = Array.isArray(scope.names) ? scope.names : [];
  if (!names.length) {
    return (
      <Banner tone="warning" title="Akun Anda belum terhubung ke nama sales">
        Data Sales hanya tampil untuk customer, lead dan order milik Anda. Data baru yang Anda buat langsung jadi milik Anda;
        untuk data lama, minta Supervisor Sales memetakan nama Anda (Pelanggan → Pemetaan sales).
      </Banner>
    );
  }
  return <Banner tone="info">Menampilkan data milik Anda (<NoTranslate>{names.join(', ')}</NoTranslate>).</Banner>;
}
