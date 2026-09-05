const prisma = require("../prisma/client");
const storageService = require("./storageService");

class ChatCleanupService {
  constructor() {
    this.lastCleanup = 0;
  }

  /**
   * Cleans up expired chat messages and their persistent storage attachments.
   * Server calculates expiration strictly based on expiresAt <= new Date().
   * @returns {Promise<{ deletedMessages: number, deletedAttachments: number }>}
   */
  async cleanupExpiredMessages() {
    const now = new Date();

    try {
      // Find all messages past their 7-day expiration
      const expiredMessages = await prisma.chatMessage.findMany({
        where: {
          expiresAt: { lte: now },
        },
        include: {
          attachments: true,
        },
        take: 200, // Batch limit to maintain fast execution
      });

      if (expiredMessages.length === 0) {
        return { deletedMessages: 0, deletedAttachments: 0 };
      }

      let deletedAttachmentsCount = 0;

      // Delete associated persistent storage files
      for (const msg of expiredMessages) {
        if (msg.attachments && msg.attachments.length > 0) {
          for (const att of msg.attachments) {
            try {
              await storageService.deleteFile(att.storagePath);
              deletedAttachmentsCount++;
            } catch (fileErr) {
              console.warn(`[ChatCleanup] Failed to delete file ${att.storagePath}:`, fileErr.message);
            }
          }
        }
      }

      // Delete database records (cascade deletes attachments automatically)
      const messageIds = expiredMessages.map((m) => m.id);
      const deleteResult = await prisma.chatMessage.deleteMany({
        where: {
          id: { in: messageIds },
        },
      });

      this.lastCleanup = Date.now();
      console.log(`[ChatCleanup] Purged ${deleteResult.count} expired messages and ${deletedAttachmentsCount} attachments.`);

      return {
        deletedMessages: deleteResult.count,
        deletedAttachments: deletedAttachmentsCount,
      };
    } catch (err) {
      console.error("[ChatCleanup] Cleanup error:", err.message);
      return { deletedMessages: 0, deletedAttachments: 0, error: err.message };
    }
  }

  /**
   * Opportunistic background cleanup: runs automatically at most once every hour
   * during standard API usage, ensuring local and serverless deployments clean up
   * even without external cron triggers.
   */
  triggerOpportunisticCleanup() {
    const oneHourMs = 60 * 60 * 1000;
    if (Date.now() - this.lastCleanup > oneHourMs) {
      this.cleanupExpiredMessages().catch((e) => {
        console.warn("[ChatCleanup] Opportunistic cleanup failed:", e.message);
      });
    }
  }
}

module.exports = new ChatCleanupService();
