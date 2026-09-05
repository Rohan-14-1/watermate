const express = require("express");
const {
  listGroupNotifications,
  sendManualNotification,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireGroupMembership } = require("../middleware/groupAccess");

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireGroupMembership);

router.get("/", listGroupNotifications);
router.post("/", sendManualNotification);
router.post("/read-all", markAllNotificationsRead);
router.post("/:notificationId/read", markNotificationRead);

module.exports = router;
