const express = require("express");
const {
  getChatMessages,
  sendChatMessage,
  getAttachmentFile,
} = require("../controllers/chatController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireGroupMembership } = require("../middleware/groupAccess");
const { handleChatAttachmentUpload } = require("../middleware/chatUploadMiddleware");

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireGroupMembership);

router.get("/", getChatMessages);
router.post("/", (req, res, next) => {
  // If Content-Type is multipart/form-data, handle upload
  if (req.is("multipart/form-data")) {
    return handleChatAttachmentUpload(req, res, next);
  }
  next();
}, sendChatMessage);
router.get("/attachments/:attachmentId", getAttachmentFile);

module.exports = router;
