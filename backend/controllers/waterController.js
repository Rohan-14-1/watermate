const fs = require("fs");
const path = require("path");
const prisma = require("../prisma/client");
const { completeTurn } = require("../services/turnService");
const storageService = require("../services/storageService");

function serializeRecord(record) {
  return {
    id: record.id,
    userId: record.userId,
    name: record.user.name,
    photoUrl: record.photoUrl,
    completedAt: record.completedAt,
  };
}

/**
 * POST /api/groups/:groupId/water
 * Verified by requireAuth and requireGroupMembership.
 * Steps:
 *   1. Check photo is present in memory buffer
 *   2. Pre-verify it is the user's turn
 *   3. Upload photo to persistent Supabase Storage (fails in prod if not configured)
 *   4. Save WaterRecord and advance turn in a single atomic DB transaction
 *   5. If DB transaction fails, execute compensating deletion of uploaded photo
 */
async function submitWater(req, res, next) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "Please upload a photo." });
    }

    // Pre-verify current turn to prevent unauthorized or unnecessary storage uploads
    if (!req.membership || !req.membership.isCurrentTurn) {
      return res.status(403).json({ message: "It is not your turn yet." });
    }

    // Upload to persistent cloud storage (Supabase Storage in production)
    let uploadResult;
    try {
      uploadResult = await storageService.uploadWaterPhoto({
        buffer: req.file.buffer,
        originalName: req.file.originalname || "water.jpg",
        mimeType: req.file.mimetype || "image/jpeg",
        groupId: req.group.id,
      });
    } catch (uploadErr) {
      console.error("[WaterController] Storage upload error:", uploadErr.message);
      return res.status(uploadErr.status || 500).json({
        message: uploadErr.message || "Failed to upload water delivery photo to storage.",
      });
    }

    let result;
    try {
      result = await completeTurn(req.group.id, req.user.id, uploadResult.photoUrl);
    } catch (err) {
      // Transaction failed: execute compensation cleanup to remove orphaned storage object
      storageService.deleteWaterPhoto(uploadResult.storagePath).catch((cleanupErr) => {
        console.error("[WaterController] Failed to clean up orphaned storage photo:", cleanupErr.message);
      });

      if (err.code === "NOT_YOUR_TURN") {
        return res.status(403).json({ message: "It is not your turn yet." });
      }
      if (err.code === "NOT_A_MEMBER") {
        return res.status(403).json({ message: err.message });
      }
      throw err;
    }

    const record = await prisma.waterRecord.findUnique({
      where: { id: result.record.id },
      include: { user: true },
    });

    res.status(201).json({
      message: "Water submitted successfully!",
      record: serializeRecord(record),
      nextTurn: {
        userId: result.nextMember.userId,
        name: result.nextMember.user.name,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getHistory(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 20, 50);

    const [records, total] = await Promise.all([
      prisma.waterRecord.findMany({
        where: { groupId: req.group.id },
        include: { user: true },
        orderBy: { completedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.waterRecord.count({ where: { groupId: req.group.id } }),
    ]);

    res.json({
      records: records.map(serializeRecord),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
}

async function getLatest(req, res, next) {
  try {
    const record = await prisma.waterRecord.findFirst({
      where: { groupId: req.group.id },
      include: { user: true },
      orderBy: { completedAt: "desc" },
    });

    res.json({ record: record ? serializeRecord(record) : null });
  } catch (err) {
    next(err);
  }
}

async function getDashboard(req, res, next) {
  try {
    const groupId = req.group.id;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [members, currentTurnMember, latestRecord, totalDeliveries, monthDeliveries, contributionCounts] =
      await Promise.all([
        prisma.groupMember.findMany({
          where: { groupId },
          include: { user: true },
          orderBy: { turnOrder: "asc" },
        }),
        prisma.groupMember.findFirst({
          where: { groupId, isCurrentTurn: true },
          include: { user: true },
        }),
        prisma.waterRecord.findFirst({
          where: { groupId },
          include: { user: true },
          orderBy: { completedAt: "desc" },
        }),
        prisma.waterRecord.count({ where: { groupId } }),
        prisma.waterRecord.count({
          where: { groupId, completedAt: { gte: startOfMonth } },
        }),
        prisma.waterRecord.groupBy({
          by: ["userId"],
          where: { groupId },
          _count: { _all: true },
        }),
      ]);

    const contributionByUserId = new Map(
      contributionCounts.map((c) => [c.userId, c._count._all])
    );

    res.json({
      group: { id: req.group.id, name: req.group.name, inviteCode: req.group.inviteCode },
      isYourTurn: currentTurnMember?.userId === req.user.id,
      currentTurn: currentTurnMember
        ? { userId: currentTurnMember.userId, name: currentTurnMember.user.name }
        : null,
      stats: {
        totalDeliveries,
        thisMonth: monthDeliveries,
      },
      lastDelivery: latestRecord ? serializeRecord(latestRecord) : null,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        turnOrder: m.turnOrder,
        isCurrentTurn: m.isCurrentTurn,
        deliveries: contributionByUserId.get(m.userId) || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitWater, getHistory, getLatest, getDashboard };
