const express = require("express");
const chatCleanupService = require("../services/chatCleanupService");

const router = express.Router();

function verifyCronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // If no secret configured in dev or basic deployment, allow execution
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${cronSecret}`) {
    return next();
  }

  return res.status(401).json({ message: "Unauthorized cron request." });
}

router.use(verifyCronAuth);

// GET/POST /api/cron/cleanup - 7-day chat & media purge
async function handleCleanup(req, res) {
  try {
    const result = await chatCleanupService.cleanupExpiredMessages();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (err) {
    console.error("[CronCleanup] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

router.get("/cleanup", handleCleanup);
router.post("/cleanup", handleCleanup);

module.exports = router;
