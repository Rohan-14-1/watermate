const prisma = require("../prisma/client");
const notificationService = require("../services/notificationService");

/**
 * GET /api/groups/:groupId/notifications
 * Lists notifications for the authenticated user within the group.
 */
async function listGroupNotifications(req, res, next) {
  try {
    const groupId = req.group.id;
    const userId = req.user.id;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { groupId, userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.notification.count({
        where: { groupId, userId, isRead: false },
      }),
    ]);

    // Also trigger self-healing turn notification check in background
    notificationService.syncAndNotifyActiveTurn(groupId).catch(() => {});

    res.json({
      notifications,
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/groups/:groupId/notifications
 * Sends a manual notification to a teammate or all team members.
 */
async function sendManualNotification(req, res, next) {
  try {
    const groupId = req.group.id;
    const { recipientType, recipientUserId, title, message } = req.body;

    const result = await notificationService.sendManualTeamNotification(
      groupId,
      req.user,
      { recipientType, recipientUserId, title, message }
    );

    res.status(201).json({
      message: `Notification sent to ${result.deliveredCount} teammate${result.deliveredCount === 1 ? "" : "s"}.`,
      deliveredCount: result.deliveredCount,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/groups/:groupId/notifications/:notificationId/read
 * Marks a specific notification as read.
 */
async function markNotificationRead(req, res, next) {
  try {
    const { notificationId } = req.params;

    const notif = await prisma.notification.findFirst({
      where: { id: notificationId, userId: req.user.id },
    });

    if (!notif) {
      return res.status(404).json({ message: "Notification not found." });
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ notification: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/groups/:groupId/notifications/read-all
 * Marks all notifications for this group as read.
 */
async function markAllNotificationsRead(req, res, next) {
  try {
    const groupId = req.group.id;
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { groupId, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    res.json({ message: "All notifications marked as read." });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/notifications/devices
 * Registers or updates a push notification device token for the user.
 */
async function registerDevice(req, res, next) {
  try {
    const { token, platform } = req.body;

    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ message: "A valid device token is required." });
    }

    const cleanPlatform = ["android", "ios", "web"].includes(platform?.toLowerCase())
      ? platform.toLowerCase()
      : "web";

    const device = await prisma.userDevice.upsert({
      where: { token: token.trim() },
      create: {
        userId: req.user.id,
        token: token.trim(),
        platform: cleanPlatform,
      },
      update: {
        userId: req.user.id,
        platform: cleanPlatform,
        lastSeenAt: new Date(),
      },
    });

    res.status(201).json({ device });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/notifications/devices
 * Unregisters a push device token (e.g. on logout).
 */
async function unregisterDevice(req, res, next) {
  try {
    const { token } = req.body;
    if (token) {
      await prisma.userDevice.deleteMany({
        where: { token: token.trim() },
      });
    }
    res.json({ message: "Device unregistered successfully." });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listGroupNotifications,
  sendManualNotification,
  markNotificationRead,
  markAllNotificationsRead,
  registerDevice,
  unregisterDevice,
};
