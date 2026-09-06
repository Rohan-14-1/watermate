const express = require("express");
const {
  registerDevice,
  unregisterDevice,
} = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/authMiddleware");
const prisma = require("../prisma/client");
const pushService = require("../services/pushService");

const router = express.Router();

router.use(requireAuth);

router.post("/devices", registerDevice);
router.delete("/devices", unregisterDevice);

// Test push notification directly to the calling user's devices
router.post("/test-self", async (req, res, next) => {
  try {
    const devices = await prisma.userDevice.findMany({
      where: { userId: req.user.id },
    });

    if (devices.length === 0) {
      return res.status(400).json({
        message: "No device registered for your account yet. Please allow push notifications in the mobile app.",
        devicesCount: 0,
      });
    }

    const title = "🎉 WaterMate Push Test";
    const body = `Hello ${req.user.name || "there"}! Push notifications are working! 💧`;

    await pushService.sendToUser(req.user.id, {
      title,
      body,
      data: {
        type: "PUSH_TEST",
      },
    });

    res.json({
      message: `Test notification dispatched to ${devices.length} device(s)!`,
      devicesCount: devices.length,
      devices: devices.map((d) => ({ platform: d.platform, createdAt: d.createdAt })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
