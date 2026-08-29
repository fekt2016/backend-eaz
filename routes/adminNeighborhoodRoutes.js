const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const {
  listNeighborhoods, createNeighborhood, updateNeighborhood, deleteNeighborhood,
  recalculateNeighborhood, recalculateAll, distanceCoverage,
} = require("../controllers/adminNeighborhoodController");

// Every route here is admin-only.
router.use(protect, restrictTo("admin"));

router.route("/")
  .get(listNeighborhoods)
  .post(createNeighborhood);

router.get("/coverage", distanceCoverage);
// Batch measurement — the one loop in this app that spends money per iteration.
router.post("/recalculate-all", recalculateAll);

router.route("/:id")
  .patch(updateNeighborhood)
  .delete(deleteNeighborhood);
router.post("/:id/recalculate", recalculateNeighborhood);

module.exports = router;
