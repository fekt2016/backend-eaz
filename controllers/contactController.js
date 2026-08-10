const Contact = require('../models/Contact');
const {
  sendContactAdminNotification,
  sendContactAutoReply,
  sendConsultationConfirmation,
  sendConsultationAdminAlert,
} = require('../utils/email');
const { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeText, sanitizeMessage } = require('../utils/sanitize');

/** Submit contact / consultation form */
const submitContact = async (req, res, next) => {
  try {
    const name         = sanitizeName(req.body.name);
    const email        = sanitizeEmail(req.body.email);
    const phone        = sanitizePhone(req.body.phone);
    const message      = sanitizeMessage(req.body.message, 3000);
    const subject      = sanitizeText(req.body.subject, 200);
    const businessName = sanitizeText(req.body.businessName, 200);
    const service      = sanitizeText(req.body.service, 100);
    const { type, plan } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Name and email are required' });
    }

    const contact = await Contact.create({
      name,
      email,
      phone:        phone        || undefined,
      message:      message      || '',
      type:         type         || 'general',
      plan:         plan         || undefined,
      businessName: businessName || undefined,
      subject:      subject      || undefined,
      service:      service      || undefined,
      status:       'new',
    });

    if (contact.type === 'consultation') {
      sendConsultationConfirmation(contact).catch(() => {});
      sendConsultationAdminAlert(contact).catch(() => {});
    } else {
      sendContactAdminNotification(contact).catch(() => {});
      sendContactAutoReply(contact).catch(() => {});
    }

    res.status(201).json({ success: true, data: contact });
  } catch (error) {
    next(error);
  }
};

/** Get all contacts (admin) — optionally filter by type */
const getContacts = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;

    const contacts = await Contact.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: contacts.length, data: contacts });
  } catch (error) {
    next(error);
  }
};

/** Get single contact (admin) */
const getContact = async (req, res, next) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Not found' });
    res.status(200).json({ success: true, data: contact });
  } catch (error) {
    next(error);
  }
};

/** Update status / admin note (admin) */
const updateContact = async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;
    const update = {};
    if (status)    update.status    = status;
    if (adminNote !== undefined) update.adminNote = adminNote;

    const contact = await Contact.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!contact) return res.status(404).json({ success: false, error: 'Not found' });
    res.status(200).json({ success: true, data: contact });
  } catch (error) {
    next(error);
  }
};

/** Delete contact (admin) */
const deleteContact = async (req, res, next) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);
    if (!contact) return res.status(404).json({ success: false, error: 'Not found' });
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

module.exports = { submitContact, getContacts, getContact, updateContact, deleteContact };
