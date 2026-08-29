const mongoose = require("mongoose");

/**
 * PickupLocation — where an order is handed to the customer (or staged for one).
 *
 * Two kinds:
 *   - 'warehouse': the shop's own origin — the Nima warehouse within Greater
 *     Accra. The default pickup/fulfillment origin for every order.
 *   - 'bus_station': a transit handoff point (e.g. an STC/VP bus station) in a
 *     destination city outside Greater Accra, where a bus_station_pickup order
 *     is dropped and the customer collects it.
 *
 * A warehouse row is NOT a customer delivery destination in its own right — it
 * is the origin, surfaced in checkout as an optional local pickup. Bus stations
 * are the only pickup that customers outside Greater Accra can choose.
 */
const PICKUP_KINDS = ["warehouse", "bus_station"];

const pickupLocationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Pickup location name is required"],
      trim: true,
    },
    kind: {
      type: String,
      enum: {
        values: PICKUP_KINDS,
        message: "Kind must be one of: {VALUES}",
      },
      required: [true, "Pickup location kind is required"],
      index: true,
    },
    // The region/city this point serves. For the warehouse this is Greater
    // Accra; for a bus station it is the destination city's region.
    region: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    landmark: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

// A warehouse is a single origin — there should be only one default warehouse.
pickupLocationSchema.index({ kind: 1, isDefault: 1 });
pickupLocationSchema.index({ city: 1, isActive: 1 });

module.exports = mongoose.model("PickupLocation", pickupLocationSchema);
module.exports.PICKUP_KINDS = PICKUP_KINDS;
