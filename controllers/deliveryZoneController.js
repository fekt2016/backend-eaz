const DeliveryZone = require('../models/DeliveryZone');

const getDeliveryZones = async (req, res, next) => {
  try {
    const zones = await DeliveryZone.find({ isActive: true }).sort({ fee: 1 });
    res.status(200).json({
      success: true,
      count: zones.length,
      data: zones
    });
  } catch (error) {
    next(error);
  }
};

const getAllZones = async (req, res, next) => {
  try {
    const zones = await DeliveryZone.find({}).sort({ fee: 1 });
    res.status(200).json({
      success: true,
      count: zones.length,
      data: zones
    });
  } catch (error) {
    next(error);
  }
};

const createDeliveryZone = async (req, res, next) => {
  try {
    const { name, fee, estimatedDays, isActive } = req.body;

    if (!name || fee == null || estimatedDays == null) {
      return res.status(400).json({
        success: false,
        error: 'Name, fee, and estimatedDays are required'
      });
    }

    const zone = await DeliveryZone.create({
      name: String(name).trim(),
      fee: Number(fee),
      estimatedDays: Number(estimatedDays),
      isActive: isActive !== undefined ? Boolean(isActive) : true
    });

    res.status(201).json({ success: true, data: zone });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'A zone with that name already exists'
      });
    }
    next(error);
  }
};

const updateDeliveryZone = async (req, res, next) => {
  try {
    const update = { ...req.body };
    if (update.fee != null) update.fee = Number(update.fee);
    if (update.estimatedDays != null) update.estimatedDays = Number(update.estimatedDays);
    if (update.isActive !== undefined) update.isActive = Boolean(update.isActive);

    const zone = await DeliveryZone.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    });

    if (!zone) {
      return res.status(404).json({ success: false, error: 'Delivery zone not found' });
    }

    res.status(200).json({ success: true, data: zone });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'A zone with that name already exists'
      });
    }
    next(error);
  }
};

const deleteDeliveryZone = async (req, res, next) => {
  try {
    const zone = await DeliveryZone.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!zone) {
      return res.status(404).json({ success: false, error: 'Delivery zone not found' });
    }

    res.status(200).json({ success: true, data: zone });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDeliveryZones,
  getAllZones,
  createDeliveryZone,
  updateDeliveryZone,
  deleteDeliveryZone
};
