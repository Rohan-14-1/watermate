const prisma = require("../prisma/client");
const pushService = require("./pushService");

// In-memory rate limiting for manual team notifications: max 10 per 10 minutes per user
const manualNoticeRateLimits = new Map();

function checkRateLimit(userId) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAllowed = 10;

  let timestamps = manualNoticeRateLimits.get(userId) || [];
  timestamps = timestamps.filter((ts) => now - ts < windowMs);

  if (timestamps.length >= maxAllowed) {
    const waitMins = Math.ceil((windowMs - (now - timestamps[0])) / 60000);
    const err = new Error(`Rate limit exceeded. Please wait ${waitMins} minute(s) before sending more team notifications.`);
    err.status = 429;
    throw err;
  }

  timestamps.push(now);
  manualNoticeRateLimits.set(userId, timestamps);
}

class NotificationService {
  /**
   * Automatic water turn notifications are intentionally disabled per WaterMate 2.0 specifications.
   */
  async syncAndNotifyActiveTurn() {
    return null;
  }

  async notifyUpcomingTurn() {
    return null;
  }

  /**
   * Sends a manual notification to a single teammate or all teammates.
   * Strict security: enforces verified team membership for all recipients.
   * @param {string} groupId
   * @param {Object} senderUser - { id, name }
   * @param {Object} payload - { recipientType, recipientUserId, title, message }
   */
  async sendManualTeamNotification(groupId, senderUser, { recipientType, recipientUserId, title, message }) {
    if (!title || !title.trim()) {
      const err = new Error("Notification title is required.");
      err.status = 400;
      throw err;
    }
    if (!message || !message.trim()) {
      const err = new Error("Notification message is required.");
      err.status = 400;
      throw err;
    }

    const cleanTitle = title.trim().slice(0, 100);
    const cleanMessage = message.trim().slice(0, 500);

    // Enforce rate limit
    checkRateLimit(senderUser.id);

    let recipientUserIds = [];

    if (recipientType === "MEMBER") {
      if (!recipientUserId) {
        const err = new Error("Please select a teammate.");
        err.status = 400;
        throw err;
      }

      if (recipientUserId === senderUser.id) {
        const err = new Error("You cannot send a team notification to yourself.");
        err.status = 400;
        throw err;
      }

      // Verify recipient belongs to the same group
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: recipientUserId } },
      });

      if (!membership) {
        const err = new Error("Selected recipient is not a member of your team.");
        err.status = 403;
        throw err;
      }

      recipientUserIds = [recipientUserId];
    } else {
      // Send to all team members (excluding sender)
      const allMembers = await prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });

      recipientUserIds = allMembers
        .map((m) => m.userId)
        .filter((uid) => uid !== senderUser.id);
    }

    if (recipientUserIds.length === 0) {
      return { success: true, deliveredCount: 0 };
    }

    // Create notifications for each recipient and dispatch push
    const formattedTitle = cleanTitle.startsWith("📢") || cleanTitle.startsWith("💧")
      ? cleanTitle
      : `📢 ${cleanTitle}`;

    const formattedBody = `${cleanMessage} — ${senderUser.name}`;

    await Promise.all(
      recipientUserIds.map(async (uid) => {
        try {
          const notif = await prisma.notification.create({
            data: {
              userId: uid,
              groupId,
              type: "MANUAL_TEAM",
              title: formattedTitle,
              body: formattedBody,
              senderId: senderUser.id,
            },
          });

          await pushService.sendToUser(uid, {
            title: formattedTitle,
            body: formattedBody,
            data: {
              type: "MANUAL_TEAM",
              groupId,
              notificationId: notif.id,
              senderId: senderUser.id,
            },
          });
        } catch (e) {
          console.warn(`[NotificationService] Error delivering to ${uid}:`, e.message);
        }
      })
    );

    return { success: true, deliveredCount: recipientUserIds.length };
  }
}

module.exports = new NotificationService();
