const express = require("express");
const {
  createGroup,
  listMyGroups,
  getGroup,
  joinGroup,
  updateGroup,
} = require("../controllers/groupController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireGroupMembership } = require("../middleware/groupAccess");

const router = express.Router();

router.use(requireAuth);

router.post("/", createGroup);
router.get("/", listMyGroups);
router.post("/join", joinGroup);
router.get("/:groupId", requireGroupMembership, getGroup);
router.put("/:groupId", requireGroupMembership, updateGroup);

module.exports = router;
