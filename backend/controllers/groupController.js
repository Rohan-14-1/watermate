const prisma = require("../prisma/client");
const { generateInviteCode } = require("../services/turnService");

function serializeGroup(group) {
  return {
    id: group.id,
    name: group.name,
    inviteCode: group.inviteCode,
    createdBy: group.createdBy,
    createdAt: group.createdAt,
    memberCount: group._count?.members,
  };
}

async function createGroup(req, res, next) {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Group name is required." });
    }

    const inviteCode = await generateInviteCode();

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        inviteCode,
        createdBy: req.user.id,
        members: {
          create: { userId: req.user.id, turnOrder: 1, isCurrentTurn: true },
        },
      },
      include: { _count: { select: { members: true } } },
    });

    res.status(201).json({ group: serializeGroup(group) });
  } catch (err) {
    next(err);
  }
}

async function listMyGroups(req, res, next) {
  try {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.id },
      include: { group: { include: { _count: { select: { members: true } } } } },
      orderBy: { joinedAt: "desc" },
    });

    const groups = memberships.map((m) => serializeGroup(m.group));
    res.json({ groups });
  } catch (err) {
    next(err);
  }
}

async function getGroup(req, res, next) {
  try {
    // req.group was already loaded and access-checked by requireGroupMembership
    const group = await prisma.group.findUnique({
      where: { id: req.group.id },
      include: { _count: { select: { members: true } } },
    });
    res.json({ group: serializeGroup(group) });
  } catch (err) {
    next(err);
  }
}

async function joinGroup(req, res, next) {
  try {
    const { inviteCode } = req.body;

    if (!inviteCode || !inviteCode.trim()) {
      return res.status(400).json({ message: "Invite code is required." });
    }

    const group = await prisma.group.findUnique({
      where: { inviteCode: inviteCode.trim().toUpperCase() },
      include: { members: true },
    });

    if (!group) {
      return res.status(404).json({ message: "Invalid invite code." });
    }

    const alreadyMember = group.members.some((m) => m.userId === req.user.id);
    if (alreadyMember) {
      return res
        .status(409)
        .json({ message: "You are already a member of this group." });
    }

    const nextTurnOrder =
      group.members.length > 0
        ? Math.max(...group.members.map((m) => m.turnOrder)) + 1
        : 1;

    await prisma.groupMember.create({
      data: {
        groupId: group.id,
        userId: req.user.id,
        turnOrder: nextTurnOrder,
        // If this is the first member somehow, they take the turn.
        isCurrentTurn: group.members.length === 0,
      },
    });

    res.status(201).json({
      message: `Successfully joined ${group.name}.`,
      group: serializeGroup(group),
    });
  } catch (err) {
    next(err);
  }
}

const storageService = require("../services/storageService");

async function updateGroup(req, res, next) {
  try {
    const { name } = req.body;

    if (req.group.createdBy !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Only the group admin can rename the group." });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Group name is required." });
    }

    const group = await prisma.group.update({
      where: { id: req.group.id },
      data: { name: name.trim() },
    });

    res.json({ group: serializeGroup(group) });
  } catch (err) {
    next(err);
  }
}

/**
 * Normal member leaves the group.
 * Group admin must transfer ownership or delete group.
 * If leaving member holds current turn, advances turn to next member.
 */
async function leaveGroup(req, res, next) {
  try {
    const groupId = req.group.id;
    const userId = req.user.id;

    // Admin rule: Admin cannot leave without transferring ownership first, or deleting group
    if (req.group.createdBy === userId) {
      return res.status(400).json({
        message: "Transfer admin ownership before leaving the group, or delete the group.",
        code: "ADMIN_MUST_TRANSFER_OR_DELETE",
      });
    }

    await prisma.$transaction(async (tx) => {
      const membership = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });

      if (!membership) {
        const err = new Error("You are not a member of this group.");
        err.status = 404;
        throw err;
      }

      // If the leaving member currently holds the turn, pass it on to next member in rotation
      if (membership.isCurrentTurn) {
        const remaining = await tx.groupMember.findMany({
          where: { groupId, userId: { not: userId } },
          orderBy: { turnOrder: "asc" },
        });

        if (remaining.length > 0) {
          const nextIndex = remaining.findIndex(
            (m) => m.turnOrder > membership.turnOrder
          );
          const next = nextIndex === -1 ? remaining[0] : remaining[nextIndex];
          await tx.groupMember.update({
            where: { id: next.id },
            data: { isCurrentTurn: true },
          });
        }
      }

      // Delete the leaving member's membership row (historical WaterRecords remain intact)
      await tx.groupMember.delete({ where: { id: membership.id } });

      // Re-sequence remaining turn orders sequentially to avoid gaps and satisfy unique constraint
      const remainingMembers = await tx.groupMember.findMany({
        where: { groupId },
        orderBy: { turnOrder: "asc" },
      });

      for (let i = 0; i < remainingMembers.length; i++) {
        await tx.groupMember.update({
          where: { id: remainingMembers[i].id },
          data: { turnOrder: -1 * (i + 1) },
        });
      }
      for (let i = 0; i < remainingMembers.length; i++) {
        await tx.groupMember.update({
          where: { id: remainingMembers[i].id },
          data: { turnOrder: i + 1 },
        });
      }
    });

    res.json({ message: "You have left the group." });
  } catch (err) {
    next(err);
  }
}

/**
 * Transfers admin ownership of the group from the current admin to another member.
 */
async function transferAdmin(req, res, next) {
  try {
    const groupId = req.group.id;
    const currentAdminId = req.user.id;
    const { newAdminUserId, newAdminMemberId } = req.body;

    if (!newAdminUserId && !newAdminMemberId) {
      return res.status(400).json({ message: "Please select a valid group member." });
    }

    if (req.group.createdBy !== currentAdminId) {
      return res.status(403).json({ message: "Only the group admin can transfer ownership." });
    }

    // Find the target member in this group
    const targetMember = await prisma.groupMember.findFirst({
      where: {
        groupId,
        OR: [
          ...(newAdminUserId ? [{ userId: newAdminUserId }] : []),
          ...(newAdminMemberId ? [{ id: newAdminMemberId }] : []),
        ],
      },
      include: { user: true },
    });

    if (!targetMember || targetMember.userId === currentAdminId) {
      return res.status(400).json({ message: "Please select a valid group member." });
    }

    // Execute admin transfer in atomic transaction with race condition protection
    const updatedGroup = await prisma.$transaction(async (tx) => {
      const g = await tx.group.findUnique({ where: { id: groupId } });
      if (!g || g.createdBy !== currentAdminId) {
        const err = new Error("Only the group admin can transfer ownership.");
        err.status = 403;
        throw err;
      }

      return tx.group.update({
        where: { id: groupId },
        data: { createdBy: targetMember.userId },
        include: { _count: { select: { members: true } } },
      });
    });

    res.json({
      message: "Admin ownership transferred successfully.",
      group: serializeGroup(updatedGroup),
      newAdmin: {
        userId: targetMember.userId,
        name: targetMember.user.name,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Permanently deletes the group and its related records.
 * Only the group admin can delete the group.
 * Asynchronously cleans up associated photos in Supabase Storage.
 */
async function deleteGroup(req, res, next) {
  try {
    const groupId = req.group.id;
    const currentAdminId = req.user.id;

    // Strict backend authorization check
    if (req.group.createdBy !== currentAdminId) {
      return res.status(403).json({
        message: "You do not have permission to delete this group.",
        code: "FORBIDDEN",
      });
    }

    // Collect associated photo URLs and chat attachments before deleting DB rows
    const waterRecords = await prisma.waterRecord.findMany({
      where: { groupId },
      select: { photoUrl: true },
    });

    const chatAttachments = await prisma.chatAttachment.findMany({
      where: { message: { groupId } },
      select: { storagePath: true },
    });

    // Delete group and associated relational data in atomic transaction
    await prisma.$transaction(async (tx) => {
      const g = await tx.group.findUnique({ where: { id: groupId } });
      if (!g) {
        const err = new Error("Group not found.");
        err.status = 404;
        throw err;
      }
      if (g.createdBy !== currentAdminId) {
        const err = new Error("You do not have permission to delete this group.");
        err.status = 403;
        throw err;
      }

      // Delete logs without foreign key cascade
      await tx.waterTurnNotificationLog.deleteMany({
        where: { groupId },
      });

      // Deleting group cascades to group_members, water_records, notifications, chat_messages & attachments
      await tx.group.delete({
        where: { id: groupId },
      });
    });

    // Clean up Supabase Storage and local files asynchronously
    const photoUrls = waterRecords.map((r) => r.photoUrl).filter(Boolean);
    if (photoUrls.length > 0) {
      storageService.deleteWaterPhotosByUrls(photoUrls).catch((err) => {
        console.error(`[deleteGroup] Failed cleaning water photos for group ${groupId}:`, err.message);
      });
    }

    for (const att of chatAttachments) {
      if (att.storagePath) {
        storageService.deleteFile(att.storagePath).catch((err) => {
          console.error(`[deleteGroup] Failed cleaning chat file '${att.storagePath}':`, err.message);
        });
      }
    }

    res.json({ message: "Group deleted successfully." });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createGroup,
  listMyGroups,
  getGroup,
  joinGroup,
  updateGroup,
  leaveGroup,
  transferAdmin,
  deleteGroup,
};
