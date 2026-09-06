const express = require("express");
const {
  createGroup,
  listMyGroups,
  getGroup,
  joinGroup,
  updateGroup,
  leaveGroup,
  transferAdmin,
  deleteGroup,
} = require("../controllers/groupController");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  requireGroupMembership,
  requireGroupAdmin,
} = require("../middleware/groupAccess");

const router = express.Router();

router.use(requireAuth);

router.post("/", createGroup);
router.get("/", listMyGroups);
router.post("/join", joinGroup);
router.get("/:groupId", requireGroupMembership, getGroup);
router.put("/:groupId", requireGroupMembership, updateGroup);
router.post("/:groupId/leave", requireGroupMembership, leaveGroup);
router.post(
  "/:groupId/transfer-admin",
  requireGroupMembership,
  requireGroupAdmin,
  transferAdmin
);
router.delete(
  "/:groupId",
  requireGroupMembership,
  requireGroupAdmin,
  deleteGroup
);

module.exports = router;
