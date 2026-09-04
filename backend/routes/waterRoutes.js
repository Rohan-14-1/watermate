const express = require("express");
const {
  submitWater,
  getHistory,
  getLatest,
  getDashboard,
} = require("../controllers/waterController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireGroupMembership } = require("../middleware/groupAccess");
const { handleWaterPhotoUpload } = require("../middleware/uploadMiddleware");

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireGroupMembership);

// Check whose turn it is BEFORE accepting a file upload, so a mistaken
// submission never writes a photo to disk for nothing.
function requireYourTurn(req, res, next) {
  if (!req.membership.isCurrentTurn) {
    return res.status(403).json({ message: "It is not your turn yet." });
  }
  next();
}

router.post("/water", requireYourTurn, handleWaterPhotoUpload, submitWater);
router.get("/water", getHistory);
router.get("/water/latest", getLatest);
router.get("/dashboard", getDashboard);

module.exports = router;
