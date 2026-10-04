const mongoose = require('mongoose');

// Simple manual billing: admin issues an invoice, marks it paid when the
// money arrives, and the amount is added to the client's credits.
const invoiceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  description: { type: String, default: '' },
  status: { type: String, enum: ['Unpaid', 'Paid', 'Void'], default: 'Unpaid' },
  paidAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
