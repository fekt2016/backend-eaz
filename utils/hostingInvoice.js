const PDFDocument = require('pdfkit');

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Build a simple PDF invoice for a hosting order. Returns a Promise that resolves with the PDF buffer.
 */
function buildInvoiceBuffer(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const orderId = String(order._id);
    const shortId = orderId.slice(-8).toUpperCase();

    doc.fontSize(20).text('INVOICE', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text(`Order #${shortId}`, { align: 'left' });
    doc.moveDown(2);

    doc.fillColor('#000').fontSize(10);
    doc.text('From', { continued: false });
    doc.text('EazWorld', 50, doc.y);
    doc.text('Hosting & Web Services');
    doc.moveDown(1.5);

    doc.text('Bill To', { continued: false });
    doc.text(order.customer?.name || '—', 50, doc.y);
    doc.text(order.customer?.email || '—');
    if (order.customer?.phone) doc.text(order.customer.phone);
    if (order.customer?.address) doc.text(order.customer.address);
    if (order.customer?.city) doc.text(order.customer.city + (order.customer?.country ? ', ' + order.customer.country : ''));
    doc.moveDown(2);

    doc.fontSize(11).text('Order Details', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Plan: ${order.planType} · ${order.tier} (${order.billingCycle === 'annual' ? 'Annual' : 'Monthly'})`);
    doc.text(`Amount: GH₵ ${order.amount}`);
    doc.text(`Payment: ${order.paymentMethod === 'paystack_card' ? 'Card' : order.paymentMethod === 'mobile_money' ? 'Mobile Money' : 'Bank Transfer'}`);
    doc.text(`Date: ${formatDate(order.createdAt)}`);
    doc.text(`Status: ${order.status}`);
    doc.moveDown(1.5);

    if (order.addons && order.addons.length > 0) {
      doc.text('Add-ons', { underline: true });
      doc.moveDown(0.3);
      order.addons.forEach((a) => {
        doc.text(`• ${a.name}${a.price ? ` — GH₵ ${a.price}` : ''}`);
      });
      doc.moveDown(1);
    }

    doc.fontSize(9).fillColor('#666');
    doc.text('Thank you for your order. For support, contact us via your dashboard or website.');
    doc.end();
  });
}

module.exports = { buildInvoiceBuffer };
