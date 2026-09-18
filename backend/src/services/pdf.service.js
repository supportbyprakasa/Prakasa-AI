const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Generate PDF final dengan:
 *  - watermark "APPROVED"
 *  - footer berisi signature metadata (nama, timestamp, hash, verification code)
 *  - halaman audit di akhir
 *
 * Catatan: Penyisipan gambar tanda tangan ke posisi placeholder di atas PDF native
 * akan diimplementasikan saat sudah ada PDF sumber dari dokumen final (Fase 4+).
 * Di Fase 3 kita cukup membuat berita acara tanda tangan sebagai halaman terpisah.
 */
async function generateSignedPdf({ title, signerName, signerEmail, documentHash, verificationCode, signedAt }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  page.drawText('BERITA ACARA TANDA TANGAN', {
    x: 60, y: height - 80, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('Prakasa AI Work OS', {
    x: 60, y: height - 100, size: 11, font, color: rgb(0.4, 0.4, 0.4),
  });

  const lines = [
    `Judul Dokumen  : ${title}`,
    `Ditandatangani : ${signerName} <${signerEmail}>`,
    `Tanggal        : ${new Date(signedAt).toISOString()}`,
    `Document Hash  : ${documentHash}`,
    `Kode Verifikasi: ${verificationCode}`,
    '',
    'Dokumen ini ditandatangani secara elektronik melalui platform Prakasa AI Work OS.',
    'Verifikasi keaslian dapat dilakukan dengan memasukkan kode verifikasi di atas',
    'pada halaman verifikasi dokumen.',
  ];

  let y = height - 140;
  for (const line of lines) {
    page.drawText(line, { x: 60, y, size: 11, font });
    y -= 18;
  }

  page.drawText('— APPROVED —', {
    x: 60, y: 80, size: 24, font: bold, color: rgb(0.1, 0.5, 0.2),
  });

  return Buffer.from(await pdf.save());
}

module.exports = { generateSignedPdf };
