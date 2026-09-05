const express = require("express");
const {
  registerDevice,
  unregisterDevice,
} = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

router.post("/devices", registerDevice);
router.delete("/devices", unregisterDevice);

module.exports = router;
