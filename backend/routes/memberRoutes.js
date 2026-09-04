const express = require("express");
const {
  listMembers,
  updateTurnOrder,
  removeMember,
} = require("../controllers/memberController");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requireGroupMembership,
  requireGroupAdmin,
} = require("../middleware/groupAccess");

// mergeParams so this router can read :groupId from the parent mount path
const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireGroupMembership);

router.get("/", listMembers);
router.put("/order", requireGroupAdmin, updateTurnOrder);
router.delete("/:memberId", requireGroupAdmin, removeMember);

module.exports = router;
