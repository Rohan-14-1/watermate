const express = require("express");
const chatCleanupService = require("../services/chatCleanupService");
const notificationService = require("../services/notificationService");
const prisma = require("../prisma/client");

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

// GET/POST /api/cron/check-turns - Scheduled turn verification and notification
async function handleCheckTurns(req, res) {
  try {
    const groups = await prisma.group.findMany({
      select: { id: true },
    });

    let notifiedCount = 0;
    for (const g of groups) {
      try {
        const notif = await notificationService.syncAndNotifyActiveTurn(g.id);
        if (notif) notifiedCount++;
      } catch (e) {
        console.warn(`[CronCheckTurns] Group ${g.id} turn sync error:`, e.message);
      }
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      groupsChecked: groups.length,
      turnsNotified: notifiedCount,
    });
  } catch (err) {
    console.error("[CronCheckTurns] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

router.get("/check-turns", handleCheckTurns);
router.post("/check-turns", handleCheckTurns);

module.exports = router;
