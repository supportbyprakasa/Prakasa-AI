// Words that mean something else in one place than in the rest of the app.
// The dictionary holds the common meaning ("Masuk" = "Sign in"); a label
// inside an element marked with a context takes the meaning listed here:
//   <Translate context="direction">Masuk</Translate>
//   <Context name="period"><DateInput label="Selesai" … /></Context>
//   { key: 'direction', header: 'Arah', translate: true, translateContext: 'direction' }
//   { key: 'qty', header: 'Jumlah', translateContext: 'quantity' }      (the header too)
//   tr('Masuk', 'direction')                                             (i18n/tr.js)
// Every entry has a case in test/i18nTranslate.test.js.
export default {
  // Stock movement direction (warehouse stock card, Accurate adjustments).
  direction: { Masuk: 'In', Keluar: 'Out' },
  // The two dates of a period (a sprint): "Selesai" is its end, not a status.
  period: { Mulai: 'Start', Selesai: 'End', Berakhir: 'End' },
  // The time something was finished (a label beside a date).
  completed: { Selesai: 'Completed' },
  // A count of goods, not money ("Jumlah" = Amount elsewhere).
  quantity: { Jumlah: 'Quantity' },
  // What a marketing campaign is for ("Tujuan" = Destination elsewhere).
  campaign: { Tujuan: 'Objective' },
  // The date goods expire ("Kedaluwarsa" = Expired, a status, elsewhere).
  expiry: { Kedaluwarsa: 'Expiry' },
  // Gmail's folder ("Sampah" = Waste, a GA service category, elsewhere).
  mail: { Sampah: 'Trash' },
  // Days of stock left in the reorder list ("Cukup" = Fair, a condition, elsewhere).
  cover: { Cukup: 'Cover' },
  // Google Chat's section of bots ("Aplikasi" = App elsewhere).
  chat: { Aplikasi: 'Apps' },
  // One person as the holder of a number ("Orang" = People, a count, elsewhere).
  holder: { Orang: 'Person' },
  // Booking a room or a vehicle ("Pesan" = Message elsewhere).
  booking: { Pesan: 'Book' },
  // The heading of a list of modules ("Modul" = Module elsewhere).
  list: { Modul: 'Modules' },
  // The date something was last done ("Terakhir" = Last elsewhere).
  upkeep: { Terakhir: 'Last done' },
  // The title of ONE form Prakasa AI fills — in its step ("Filling 4 fields in
  // the New customer form") and in the handbook's table of forms. Elsewhere the
  // same words name a page or a count ("Pelanggan baru" = New customers).
  form: { 'Pelanggan baru': 'New customer', Kampanye: 'Campaign', 'Tiket IT': 'IT ticket', 'Template checklist': 'Checklist template' },
};
