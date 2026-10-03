// What a failed verification means (revision F22). Only the server's own
// answer says a code is unknown or invalid; a timeout, a network error, a
// server error or a rate limit says nothing about the document — the page
// then reads "Belum dapat memverifikasi" and offers a retry, never "not found".
export function verifyErrorState(error) {
  const status = error?.response?.status;
  const message = error?.response?.data?.error?.message;
  if (status === 404) {
    return {
      kind: 'not_found', tone: 'error', icon: 'cancel', retry: false,
      title: 'Kode verifikasi tidak ditemukan',
      description: message || 'Kode ini tidak terdaftar. Periksa kembali kode atau QR yang dipindai.',
    };
  }
  if (status === 400) {
    return {
      kind: 'invalid', tone: 'error', icon: 'cancel', retry: false,
      title: 'Kode verifikasi tidak valid',
      description: message || 'Format kode tidak dikenali. Periksa kembali kode atau QR yang dipindai.',
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limited', tone: 'warning', icon: 'hourglass_top', retry: true,
      title: 'Belum dapat memverifikasi',
      description: 'Terlalu banyak permintaan verifikasi dalam waktu singkat. Tunggu sebentar, lalu coba lagi. Ini bukan tanda dokumen bermasalah.',
    };
  }
  return {
    kind: 'unavailable', tone: 'warning', icon: 'cloud_off', retry: true,
    title: 'Belum dapat memverifikasi',
    description: 'Layanan verifikasi belum dapat dihubungi (koneksi terputus atau server sedang bermasalah). Ini bukan tanda dokumen palsu; coba lagi beberapa saat lagi.',
  };
}
