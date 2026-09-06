const express = require("express");
const {
  getChickenTurn,
  markChickenDone,
  approveChicken,
  getChickenHistory,
} = require("../controllers/chickenController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireGroupMembership } = require("../middleware/groupAccess");

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireGroupMembership);

router.get("/", getChickenTurn);
router.post("/done", markChickenDone);
router.post("/approve", approveChicken);
router.get("/history", getChickenHistory);

module.exports = router;
