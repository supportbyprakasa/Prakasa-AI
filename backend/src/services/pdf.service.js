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
  page.drawText('Prakasa Workspace', {
    x: 60, y: height - 100, size: 11, font, color: rgb(0.4, 0.4, 0.4),
  });

  const lines = [
    `Judul Dokumen  : ${title}`,
    `Ditandatangani : ${signerName} <${signerEmail}>`,
    `Tanggal        : ${new Date(signedAt).toISOString()}`,
    `Document Hash  : ${documentHash}`,
    `Kode Verifikasi: ${verificationCode}`,
    '',
    'Dokumen ini ditandatangani secara elektronik melalui platform Prakasa Workspace.',
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

async function generateSignedPdfWithQr({
  title,
  signerName,
  signerEmail,
  documentHash,
  verificationCode,
  signedAt,
  qrBuffer,
  verificationUrl,
  hashAlgorithm = 'sha256',
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([595, 842]);
  const { width, height } = page.getSize();

  page.drawText('BERITA ACARA TANDA TANGAN', {
    x: 60, y: height - 80, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('Prakasa Workspace', {
    x: 60, y: height - 100, size: 11, font, color: rgb(0.4, 0.4, 0.4),
  });

  const lines = [
    { label: 'Judul Dokumen', value: title, size: 11 },
    { label: 'Ditandatangani', value: `${signerName} <${signerEmail}>`, size: 11 },
    { label: 'Tanggal', value: new Date(signedAt).toISOString(), size: 11 },
    { label: `Hash ${String(hashAlgorithm).toUpperCase()}`, value: documentHash, size: 8 },
    { label: 'Kode Verifikasi', value: verificationCode, size: 10 },
    ...(verificationUrl
      ? [{ label: 'URL Verifikasi', value: verificationUrl, size: 8 }]
      : []),
  ];

  let y = height - 140;
  for (const line of lines) {
    page.drawText(`${line.label}: `, {
      x: 60, y, size: line.size, font: bold, color: rgb(0.1, 0.1, 0.1),
    });
    const prefixWidth = bold.widthOfTextAtSize(`${line.label}: `, line.size);
    const value = String(line.value || '');
    const maxChars = line.size <= 8 ? 78 : 58;
    const chunks = value.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [''];
    for (let index = 0; index < chunks.length; index += 1) {
      page.drawText(chunks[index], {
        x: index === 0 ? 60 + prefixWidth : 60,
        y,
        size: line.size,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= index === chunks.length - 1 ? 18 : 12;
    }
  }

  y -= 4;
  for (const line of [
    'Dokumen ini ditandatangani secara elektronik melalui platform Prakasa Workspace.',
    'Verifikasi keaslian dapat dilakukan melalui kode atau QR verifikasi.',
  ]) {
    page.drawText(line, { x: 60, y, size: 10, font });
    y -= 16;
  }

  if (qrBuffer) {
    const qrImage = await pdf.embedPng(qrBuffer);
    const qrSize = 130;
    const qrX = width - 60 - qrSize;
    const qrY = 70;
    page.drawImage(qrImage, {
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });
    page.drawText('Scan untuk verifikasi', {
      x: qrX,
      y: qrY - 14,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  page.drawText('— APPROVED —', {
    x: 60, y: 80, size: 24, font: bold, color: rgb(0.1, 0.5, 0.2),
  });

  return Buffer.from(await pdf.save());
}

module.exports = { generateSignedPdf, generateSignedPdfWithQr };
