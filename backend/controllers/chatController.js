const prisma = require("../prisma/client");
const storageService = require("../services/storageService");
const chatCleanupService = require("../services/chatCleanupService");
const pushService = require("../services/pushService");

function serializeAttachment(att, groupId) {
  return {
    id: att.id,
    fileName: att.fileName,
    fileType: att.fileType,
    mimeType: att.mimeType,
    fileSize: att.fileSize,
    url: `/api/groups/${groupId}/chat/attachments/${att.id}`,
    createdAt: att.createdAt,
  };
}

function serializeMessage(msg, currentUserId, groupId) {
  return {
    id: msg.id,
    groupId: msg.groupId,
    senderId: msg.senderId,
    senderName: msg.sender ? msg.sender.name : "Unknown",
    isSelf: msg.senderId === currentUserId,
    text: msg.text,
    content: msg.text, // For full frontend convenience
    createdAt: msg.createdAt,
    expiresAt: msg.expiresAt,
    attachments: (msg.attachments || []).map((att) => serializeAttachment(att, groupId)),
  };
}

/**
 * GET /api/groups/:groupId/chat
 * Query options:
 * - limit: max messages to retrieve (default 30, max 50)
 * - before: fetch messages created before this timestamp (cursor for loading older history)
 * - since: fetch messages created after this timestamp (for lightweight polling updates)
 */
async function getChatMessages(req, res, next) {
  try {
    const groupId = req.group.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 50);
    const before = req.query.before ? new Date(req.query.before) : null;
    const since = req.query.since ? new Date(req.query.since) : null;

    const where = {
      groupId,
      expiresAt: { gt: new Date() }, // Exclude expired messages
    };

    if (before && !isNaN(before.getTime())) {
      where.createdAt = { lt: before };
    } else if (since && !isNaN(since.getTime())) {
      where.createdAt = { gt: since };
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      include: {
        sender: { select: { id: true, name: true } },
        attachments: true,
      },
      orderBy: { createdAt: since ? "asc" : "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const resultMessages = hasMore ? messages.slice(0, limit) : messages;

    // Normalize ordering to chronological (asc) for presentation
    if (!since) {
      resultMessages.reverse();
    }

    // Trigger opportunistic background cleanup of expired messages
    chatCleanupService.triggerOpportunisticCleanup();

    res.json({
      messages: resultMessages.map((m) => serializeMessage(m, req.user.id, groupId)),
      hasMore,
      oldestTimestamp: resultMessages.length > 0 ? resultMessages[0].createdAt : null,
      latestTimestamp: resultMessages.length > 0 ? resultMessages[resultMessages.length - 1].createdAt : null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/groups/:groupId/chat
 * Creates a chat message with text and/or media attachment.
 * Computes 7-day expiration strictly from server time.
 */
async function sendChatMessage(req, res, next) {
  try {
    const groupId = req.group.id;
    const text = (req.body.text || req.body.content || "").trim().slice(0, 2000);

    if (!text && !req.file) {
      return res.status(400).json({ message: "Please provide a message or an attachment." });
    }

    // Server calculates expiration: exactly 7 days from now
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Create the message first
    const message = await prisma.chatMessage.create({
      data: {
        groupId,
        senderId: req.user.id,
        text: text || null,
        createdAt: now,
        expiresAt,
      },
    });

    // If an attachment file was provided with the request, upload to persistent storage
    let attachment = null;
    if (req.file) {
      try {
        const uploadResult = await storageService.uploadFile({
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          prefix: `chat/${groupId}`,
        });

        attachment = await prisma.chatAttachment.create({
          data: {
            messageId: message.id,
            fileName: req.file.originalname,
            fileType: req.fileTypeCategory || "DOCUMENT",
            mimeType: req.file.mimetype,
            fileSize: req.file.size,
            storagePath: uploadResult.storagePath,
          },
        });
      } catch (uploadErr) {
        console.error("[ChatController] Attachment upload failed:", uploadErr.message);
        // Clean up message if attachment failed so message isn't left without intended media
        await prisma.chatMessage.delete({ where: { id: message.id } }).catch(() => {});
        return res.status(500).json({ message: "Failed to upload file attachment. Please try again." });
      }
    }

    const fullMessage = await prisma.chatMessage.findUnique({
      where: { id: message.id },
      include: {
        sender: { select: { id: true, name: true } },
        attachments: true,
      },
    });

    // Asynchronously dispatch push notification to other group members
    (async () => {
      try {
        const teammates = await prisma.groupMember.findMany({
          where: { groupId, userId: { not: req.user.id } },
          select: { userId: true },
        });

        const snippet = text || (req.file ? `Sent an attachment: ${req.file.originalname}` : "New message");
        const senderName = req.user.name || "Teammate";

        for (const mate of teammates) {
          pushService.sendToUser(mate.userId, {
            title: `💬 ${senderName}`,
            body: snippet,
            data: {
              type: "CHAT_MESSAGE",
              groupId,
              messageId: message.id,
              senderId: req.user.id,
            },
          }).catch(() => {});
        }
      } catch (pushErr) {
        console.warn("[ChatController] Push dispatch error:", pushErr.message);
      }
    })();

    res.status(201).json({
      message: serializeMessage(fullMessage, req.user.id, groupId),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/groups/:groupId/chat/attachments/:attachmentId
 * Authenticated streaming of chat attachments. Verifies team membership.
 */
async function getAttachmentFile(req, res, next) {
  try {
    const { groupId, attachmentId } = req.params;

    const attachment = await prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: { select: { groupId: true, expiresAt: true } },
      },
    });

    if (!attachment || !attachment.message || attachment.message.groupId !== groupId) {
      return res.status(404).json({ message: "Attachment not found." });
    }

    if (new Date(attachment.message.expiresAt) <= new Date()) {
      return res.status(410).json({ message: "This attachment has expired after 7 days." });
    }

    const { buffer, redirectUrl, mimeType } = await storageService.getFile(
      attachment.storagePath,
      attachment.mimeType
    );

    if (redirectUrl) {
      return res.redirect(302, redirectUrl);
    }

    if (!buffer) {
      return res.status(404).json({ message: "Attachment file could not be retrieved." });
    }

    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.fileName)}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getChatMessages,
  sendChatMessage,
  getAttachmentFile,
};
