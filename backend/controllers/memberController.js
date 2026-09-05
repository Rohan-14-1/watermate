const prisma = require("../prisma/client");

function serializeMember(member) {
  return {
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    profileImage: member.user.profileImage,
    turnOrder: member.turnOrder,
    isCurrentTurn: member.isCurrentTurn,
    joinedAt: member.joinedAt,
  };
}

async function listMembers(req, res, next) {
  try {
    const members = await prisma.groupMember.findMany({
      where: { groupId: req.group.id },
      include: { user: true },
      orderBy: { turnOrder: "asc" },
    });

    res.json({ members: members.map(serializeMember) });
  } catch (err) {
    next(err);
  }
}

/**
 * Body: { order: [memberId1, memberId2, ...] } - the desired new order,
 * listed top to bottom. Only the group admin can do this. The member who
 * currently holds the turn keeps holding it; only the numbering changes.
 */
async function updateTurnOrder(req, res, next) {
  try {
    const { order } = req.body;

    if (!Array.isArray(order) || order.length === 0) {
      return res
        .status(400)
        .json({ message: "Provide the new member order as a list." });
    }

    const members = await prisma.groupMember.findMany({
      where: { groupId: req.group.id },
    });

    const memberIds = new Set(members.map((m) => m.id));
    const orderIds = new Set(order);

    if (
      order.length !== members.length ||
      ![...orderIds].every((id) => memberIds.has(id))
    ) {
      return res.status(400).json({
        message: "The provided order must include every group member exactly once.",
      });
    }

    // Two-phase update to avoid violating the (groupId, turnOrder) unique
    // constraint while positions are mid-shuffle: first move everyone to a
    // temporary negative range, then assign final positions.
    await prisma.$transaction([
      ...order.map((memberId, index) =>
        prisma.groupMember.update({
          where: { id: memberId },
          data: { turnOrder: -1 * (index + 1) },
        })
      ),
      ...order.map((memberId, index) =>
        prisma.groupMember.update({
          where: { id: memberId },
          data: { turnOrder: index + 1 },
        })
      ),
    ]);

    const updated = await prisma.groupMember.findMany({
      where: { groupId: req.group.id },
      include: { user: true },
      orderBy: { turnOrder: "asc" },
    });

    res.json({ members: updated.map(serializeMember) });
  } catch (err) {
    next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const { memberId } = req.params;

    const member = await prisma.groupMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.groupId !== req.group.id) {
      return res.status(404).json({ message: "Member not found." });
    }

    if (member.userId === req.group.createdBy) {
      return res
        .status(400)
        .json({ message: "The group admin cannot be removed." });
    }

    await prisma.$transaction(async (tx) => {
      // If the member being removed currently holds the turn, pass it on
      // to the next person in the rotation before deleting them.
      if (member.isCurrentTurn) {
        const remaining = await tx.groupMember.findMany({
          where: { groupId: req.group.id, id: { not: member.id } },
          orderBy: { turnOrder: "asc" },
        });

        if (remaining.length > 0) {
          const nextIndex = remaining.findIndex(
            (m) => m.turnOrder > member.turnOrder
          );
          const next = nextIndex === -1 ? remaining[0] : remaining[nextIndex];
          await tx.groupMember.update({
            where: { id: next.id },
            data: { isCurrentTurn: true },
          });
        }
      }

      await tx.groupMember.delete({ where: { id: member.id } });
    });

    if (member.isCurrentTurn) {
      const notificationService = require("../services/notificationService");
      notificationService.syncAndNotifyActiveTurn(req.group.id).catch(() => {});
    }

    res.json({ message: "Member removed." });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMembers, updateTurnOrder, removeMember };
