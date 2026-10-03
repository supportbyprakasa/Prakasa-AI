import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Banner from '../../components/Banner';
import Button from '../../components/Button';
import { LoadingState } from '../../components/EmptyState';
import { toDate } from '../../components/format';
import { namesFor } from '../../i18n/names.js';
import {
  PRINT_DOCUMENTS, apiError, dueDate, formatCount, formatRupiah, terbilang,
} from './salesModel';
import './sales-print.css';

// Printable Sales documents — Sales Order, Surat Jalan, Invoice and Kwitansi —
// laid out on A4. "Cetak / Simpan PDF" uses the browser's print dialog, so the
// same page prints on paper or saves a PDF. Opened in its own tab, outside the
// app layout, from the order page.

const qty = (n) => formatCount(Number(n));
// A missing date prints nothing (its row is left out), never a dash.
// A printed document is always Indonesian, whatever the interface language:
// the date uses the Indonesian month names and the sheet is a no-translate zone.
const ID_MONTHS = namesFor('id').monthsShort;
const printDate = (value) => {
  const date = value ? toDate(value) : null;
  return date ? `${date.getDate()} ${ID_MONTHS[date.getMonth()]} ${date.getFullYear()}` : '';
};
const printDateTime = (date) => `${printDate(date)}, ${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}`;

function CompanyHeader({ settings, letterhead }) {
  if (letterhead) {
    return <img className="sp-letterhead" src={`data:${letterhead.mimeType};base64,${letterhead.imageBase64}`} alt="Kop surat" />;
  }
  const name = settings.companyName || settings.entityName || 'Prakasa';
  return (
    <div className="sp-company">
      <img className="sp-company__logo" src={settings.logoUrl || '/logo.png'} alt="" aria-hidden="true" />
      <div>
        <div className="sp-company__name">{name}</div>
        {settings.address ? <div data-no-translate="">{settings.address}</div> : null}
        {(settings.phone || settings.email) ? <div>{[settings.phone, settings.email].filter(Boolean).join(' · ')}</div> : null}
        {settings.npwp ? <div>NPWP {settings.npwp}</div> : null}
      </div>
    </div>
  );
}

function Meta({ rows }) {
  return (
    <dl className="sp-meta">
      {rows.filter((r) => r && r[1]).map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function Signatures({ roles }) {
  return (
    <div className="sp-signatures">
      {roles.map((role) => (
        <div key={role} className="sp-signature">
          <div>{role}</div>
          <div className="sp-signature__line">( ........................................ )</div>
        </div>
      ))}
    </div>
  );
}

function LinesTable({ lines, withPrices }) {
  return (
    <table className="sp-table">
      <thead>
        <tr>
          <th className="is-num">No</th>
          <th>SKU</th>
          <th>Produk</th>
          <th className="is-num">Qty</th>
          {withPrices ? <th className="is-num">Harga</th> : null}
          {withPrices ? <th className="is-num">Jumlah</th> : <th>Keterangan</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.lineNo}>
            <td data-no-translate="" className="is-num">{l.lineNo}</td>
            <td data-no-translate="" className="sp-nowrap">{l.skuCode || '—'}</td>
            <td data-no-translate="">{l.productName}</td>
            <td className="is-num">{qty(l.qty)}</td>
            {withPrices ? <td className="is-num sp-nowrap">{formatRupiah(l.unitPrice)}</td> : null}
            {withPrices ? <td className="is-num sp-nowrap">{formatRupiah(l.lineTotal)}</td> : <td />}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ order, invoice }) {
  const rows = [
    ['Subtotal', formatRupiah(order.subtotal)],
    Number(order.deliveryFee) ? ['Ongkos kirim', formatRupiah(order.deliveryFee)] : null,
    ['Total', formatRupiah(order.totalAmount), true],
    invoice && Number(order.settledAmount) ? ['Sudah dibayar', formatRupiah(order.settledAmount)] : null,
    invoice ? ['Sisa tagihan', formatRupiah(order.outstandingAmount), true] : null,
  ].filter(Boolean);
  return (
    <table className="sp-totals">
      <tbody>
        {rows.map(([label, value, strong]) => (
          <tr key={label} className={strong ? 'is-strong' : undefined}><th>{label}</th><td>{value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function Parties({ order, title = 'Kepada' }) {
  return (
    <div className="sp-party">
      <div className="sp-party__label">{title}</div>
      <div data-no-translate="" className="sp-party__name">{order.customerName}</div>
      {order.customerCode ? <div data-no-translate="">{order.customerCode}</div> : null}
      {order.customerAddress ? <div data-no-translate="">{order.customerAddress}</div> : null}
      {(order.customerContact || order.customerPhone) ? <div>{[order.customerContact, order.customerPhone].filter(Boolean).join(' · ')}</div> : null}
    </div>
  );
}

function Notes({ items }) {
  const text = items.filter(Boolean);
  if (!text.length) return null;
  return <div className="sp-notes">{text.map((t) => <p key={t}>{t}</p>)}</div>;
}

export default function SalesPrint() {
  const { doc, id } = useParams();
  const [params] = useSearchParams();
  const [state, setState] = useState({ loading: true, error: '', data: null });

  useEffect(() => {
    api.get(`/sales/orders/${id}/print`)
      .then((r) => setState({ loading: false, error: '', data: r.data.data }))
      .catch((err) => setState({ loading: false, error: apiError(err, 'Sales order tidak ditemukan'), data: null }));
  }, [id]);

  const title = PRINT_DOCUMENTS[doc];
  const data = state.data;
  const order = data?.order;
  const payment = doc === 'receipt' ? data?.payments.find((p) => String(p.id) === params.get('payment')) : null;
  const number = order && ({
    so: order.orderNumber, do: order.doNumbers, invoice: order.invoiceNumbers, receipt: payment ? `KW-${order.orderNumber}-${payment.id}` : null,
  })[doc];

  useEffect(() => {
    if (title && number) document.title = `${title} ${number}`;
  }, [title, number]);

  let problem = '';
  if (!title) problem = 'Jenis dokumen tidak dikenal.';
  else if (order && doc === 'do' && !order.doNumbers) problem = 'Surat jalan untuk sales order ini belum dibuat.';
  else if (order && doc === 'invoice' && !order.invoiceNumbers) problem = 'Invoice untuk sales order ini belum dibuat.';
  else if (order && doc === 'receipt' && !payment) problem = 'Pembayaran tidak ditemukan.';

  const back = () => (window.history.length > 1 ? window.history.back() : window.close());

  return (
    <div className="sp-wrap">
      <div className="sp-toolbar">
        {/* A standalone print tab outside the app frame (no PageTrail): its own way back. */}
        <Button variant="text" icon="arrow_back" onClick={back}>Kembali</Button>
        {order && !problem ? <Button icon="print" onClick={() => window.print()}>Cetak atau simpan PDF</Button> : null}
      </div>
      {/* The document's own <h1> shows once it is ready; until then (or when it
          cannot be shown) the page still has one, for screen readers. */}
      {!(order && !problem) ? <h1 className="pw-visually-hidden">{title || 'Dokumen sales'}</h1> : null}
      {state.loading ? <LoadingState label="Menyiapkan dokumen…" /> : null}
      {state.error ? <div className="sp-message"><Banner tone="error">{state.error}</Banner></div> : null}
      {problem && !state.loading ? <div className="sp-message"><Banner tone="warning">{problem}</Banner></div> : null}

      {order && !problem ? (
        <article className="sp-sheet" aria-label={`${title} ${number}`} data-no-translate="">
          <CompanyHeader settings={data.settings} letterhead={data.letterhead} />

          <div className="sp-heading">
            <h1 className="sp-title">{title.toUpperCase()}</h1>
            {doc === 'invoice' && Number(order.outstandingAmount) <= 0 ? <span className="sp-stamp">LUNAS</span> : null}
          </div>

          {doc === 'receipt' ? (
            <>
              <Meta rows={[['No. kwitansi', number], ['Tanggal', printDate(payment.paidAt)]]} />
              <table className="sp-receipt">
                <tbody>
                  <tr><th>Telah terima dari</th><td>{order.customerName}{order.customerCode ? ` (${order.customerCode})` : ''}</td></tr>
                  <tr><th>Uang sejumlah</th><td className="sp-receipt__words" data-no-translate="">{terbilang(payment.amount)}</td></tr>
                  <tr>
                    <th>Untuk pembayaran</th>
                    <td>
                      {order.invoiceNumbers ? `Invoice ${order.invoiceNumbers}` : `Sales order ${order.orderNumber}`}
                      {payment.method ? ` · ${payment.method}` : ''}
                      {payment.note ? ` · ${payment.note}` : ''}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="sp-amount">{formatRupiah(payment.amount)}</div>
              <Signatures roles={['Penerima']} />
            </>
          ) : (
            <>
              <div className="sp-top">
                <Parties order={order} title={doc === 'do' ? 'Dikirim kepada' : 'Kepada'} />
                <Meta rows={[
                  [doc === 'so' ? 'No. SO' : doc === 'do' ? 'No. surat jalan' : 'No. invoice', number],
                  [doc === 'do' ? 'Tanggal kirim' : doc === 'invoice' ? 'Tanggal invoice' : 'Tanggal order',
                    printDate(doc === 'do' ? (order.doDate || order.deliveryDate) : doc === 'invoice' ? order.invoiceDate : order.orderDate)],
                  doc !== 'so' ? ['No. SO', order.orderNumber] : null,
                  doc === 'so' && order.deliveryDate ? ['Rencana kirim', printDate(order.deliveryDate)] : null,
                  doc === 'invoice' ? ['Jatuh tempo', printDate(order.dueDate || dueDate(order.invoiceDate, data.settings.paymentTermsDays))] : null,
                  doc === 'invoice' && order.doNumbers ? ['No. surat jalan', order.doNumbers] : null,
                  ['Sales', order.salesPersonName],
                ]}
                />
              </div>

              <LinesTable lines={data.lines} withPrices={doc !== 'do'} />
              {doc === 'do' ? (
                <p className="sp-small">Jumlah barang: {qty(data.lines.reduce((s, l) => s + Number(l.qty), 0))} dalam {data.lines.length} baris.</p>
              ) : (
                <div className="sp-summary">
                  <div className="sp-summary__words">
                    {doc === 'invoice' ? <><span className="pw-strong">Terbilang:</span> <span data-no-translate="">{terbilang(order.outstandingAmount > 0 ? order.outstandingAmount : order.totalAmount)}</span></> : null}
                    {Number(order.taxAmount) ? <div className="sp-small">PPN 11% yang dicatat: {formatRupiah(Math.abs(Number(order.taxAmount)))}</div> : null}
                  </div>
                  <Totals order={order} invoice={doc === 'invoice'} />
                </div>
              )}

              {doc === 'invoice' && data.settings.bankAccounts ? (
                <div className="sp-bank"><span className="pw-strong">Pembayaran ke:</span><div className="sp-prewrap">{data.settings.bankAccounts}</div></div>
              ) : null}
              <Notes items={[
                doc === 'invoice' ? data.settings.invoiceNote : null,
                doc === 'do' ? data.settings.deliveryNote : null,
                order.notes ? `Catatan: ${order.notes}` : null,
              ]}
              />

              <Signatures roles={{
                so: ['Dibuat oleh', 'Disetujui', 'Pelanggan'],
                do: ['Disiapkan (gudang)', 'Pengirim', 'Penerima'],
                invoice: ['Hormat kami'],
              }[doc]}
              />
            </>
          )}

          <footer className="sp-footer">
            Dicetak {printDateTime(new Date())}
            {data.printedBy ? ` oleh ${data.printedBy}` : ''} · Prakasa Workspace
          </footer>
        </article>
      ) : null}
    </div>
  );
}
