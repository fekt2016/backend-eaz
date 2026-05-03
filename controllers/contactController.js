const Contact = require('../models/Contact');
const { sendContactAdminNotification, sendContactAutoReply } = require('../utils/email');

/**
 * Submit contact form
 */
const submitContact = async (req, res, next) => {
  try {
    const { name, email, phone, message, type, plan, businessName } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required'
      });
    }

    const messageRequired = type !== 'hosting-enquiry';
    if (messageRequired && !message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    const contact = await Contact.create({
      name,
      email,
      phone: phone || undefined,
      message: message || '',
      type: type || 'general',
      plan: plan || undefined,
      businessName: businessName || undefined
    });

    sendContactAdminNotification(contact).catch(() => {});
    sendContactAutoReply(contact).catch(() => {});

    res.status(201).json({
      success: true,
      data: contact
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all contacts (for admin)
 */
const getContacts = async (req, res, next) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: contacts.length,
      data: contacts
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitContact,
  getContacts,
};

