const prisma = require("../prisma/client");

/**
 * Ensures a ChickenTurn record exists for the group and is pointing to a valid member.
 */
async function getOrCreateChickenTurn(groupId, tx = prisma) {
  let turn = await tx.chickenTurn.findUnique({
    where: { groupId },
    include: {
      currentUser: true,
      pendingDelivery: {
        include: { broughtBy: true },
      },
    },
  });

  const members = await tx.groupMember.findMany({
    where: { groupId },
    orderBy: { turnOrder: "asc" },
    include: { user: true },
  });

  if (members.length === 0) {
    if (turn && turn.currentUserId) {
      turn = await tx.chickenTurn.update({
        where: { id: turn.id },
        data: { currentUserId: null, status: "WAITING_FOR_COMPLETION", pendingDeliveryId: null },
        include: { currentUser: true, pendingDelivery: { include: { broughtBy: true } } },
      });
    }
    return turn;
  }

  // If no turn record exists yet, initialize with the first member in rotation
  if (!turn) {
    turn = await tx.chickenTurn.create({
      data: {
        groupId,
        currentUserId: members[0].userId,
        status: "WAITING_FOR_COMPLETION",
      },
      include: {
        currentUser: true,
        pendingDelivery: {
          include: { broughtBy: true },
        },
      },
    });
    return turn;
  }

  // If turn points to no member or a member no longer in the group, reassign to first member
  const isMemberStillPresent = members.some((m) => m.userId === turn.currentUserId);
  if (!turn.currentUserId || !isMemberStillPresent) {
    turn = await tx.chickenTurn.update({
      where: { id: turn.id },
      data: {
        currentUserId: members[0].userId,
        status: "WAITING_FOR_COMPLETION",
        pendingDeliveryId: null,
      },
      include: {
        currentUser: true,
        pendingDelivery: {
          include: { broughtBy: true },
        },
      },
    });
  }

  return turn;
}

/**
 * Returns the status of the chicken turn for a specific user and group.
 */
async function getChickenStatus(groupId, userId) {
  const turn = await getOrCreateChickenTurn(groupId);

  if (!turn || !turn.currentUserId) {
    return {
      groupId,
      currentTurn: null,
      status: "EMPTY",
      isYourTurn: false,
      canApprove: false,
      isWaitingForApproval: false,
      pendingDelivery: null,
    };
  }

  const isWaitingForApproval = turn.status === "WAITING_FOR_APPROVAL";
  const isYourTurn = turn.currentUserId === userId && turn.status === "WAITING_FOR_COMPLETION";
  const canApprove =
    isWaitingForApproval &&
    turn.pendingDelivery &&
    turn.pendingDelivery.broughtById !== userId;

  return {
    groupId,
    currentTurn: turn.currentUser
      ? {
          userId: turn.currentUser.id,
          name: turn.currentUser.name,
        }
      : null,
    status: turn.status,
    isYourTurn,
    canApprove,
    isWaitingForApproval,
    pendingDelivery: turn.pendingDelivery
      ? {
          id: turn.pendingDelivery.id,
          broughtById: turn.pendingDelivery.broughtById,
          broughtByName: turn.pendingDelivery.broughtBy?.name || "Member",
          completedAt: turn.pendingDelivery.completedAt,
        }
      : null,
  };
}

/**
 * The current Chicken member clicks "Done".
 * Creates a pending delivery and changes status to WAITING_FOR_APPROVAL.
 * Does NOT advance the turn.
 */
async function markChickenDone(groupId, userId) {
  return prisma.$transaction(async (tx) => {
    // 1. Verify group membership
    const membership = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      include: { user: true },
    });

    if (!membership) {
      const err = new Error("You are not a member of this group.");
      err.status = 403;
      err.code = "NOT_A_MEMBER";
      throw err;
    }

    // 2. Ensure chicken turn exists
    let turn = await getOrCreateChickenTurn(groupId, tx);

    if (!turn || turn.currentUserId !== userId) {
      const err = new Error("It is not your chicken turn.");
      err.status = 403;
      err.code = "NOT_YOUR_TURN";
      throw err;
    }

    // 3. Verify not already waiting for approval
    if (turn.status === "WAITING_FOR_APPROVAL") {
      const err = new Error("A chicken delivery is already waiting for approval.");
      err.status = 409;
      err.code = "ALREADY_WAITING_APPROVAL";
      throw err;
    }

    // 4. Double check database protection against duplicate pending deliveries
    const existingPending = await tx.chickenDelivery.findFirst({
      where: { groupId, status: "WAITING_FOR_APPROVAL" },
    });

    if (existingPending) {
      const err = new Error("A chicken delivery is already waiting for approval.");
      err.status = 409;
      err.code = "PENDING_DELIVERY_EXISTS";
      throw err;
    }

    // 5. Create ChickenDelivery record
    const delivery = await tx.chickenDelivery.create({
      data: {
        groupId,
        broughtById: userId,
        status: "WAITING_FOR_APPROVAL",
        completedAt: new Date(),
      },
      include: { broughtBy: true },
    });

    // 6. Update ChickenTurn status (Do NOT move turn yet!)
    const updatedTurn = await tx.chickenTurn.update({
      where: { id: turn.id },
      data: {
        status: "WAITING_FOR_APPROVAL",
        pendingDeliveryId: delivery.id,
      },
      include: {
        currentUser: true,
        pendingDelivery: { include: { broughtBy: true } },
      },
    });

    return {
      message: "Chicken turn marked as done. Waiting for approval.",
      turn: updatedTurn,
      delivery,
    };
  });
}

/**
 * Another member of the group approves the chicken delivery.
 * - Submitter CANNOT approve themselves (403).
 * - Exactly one approval succeeds (atomic concurrency protection).
 * - Advances chicken turn to the next member in rotation.
 */
async function approveChickenDelivery(groupId, approverUserId) {
  return prisma.$transaction(async (tx) => {
    // 1. Verify approver belongs to group
    const membership = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: approverUserId } },
      include: { user: true },
    });

    if (!membership) {
      const err = new Error("You are not a member of this group.");
      err.status = 403;
      err.code = "NOT_A_MEMBER";
      throw err;
    }

    // 2. Fetch ChickenTurn
    const turn = await tx.chickenTurn.findUnique({
      where: { groupId },
      include: { pendingDelivery: true },
    });

    if (!turn || turn.status !== "WAITING_FOR_APPROVAL" || !turn.pendingDeliveryId) {
      const err = new Error("No chicken delivery is waiting for approval.");
      err.status = 400;
      err.code = "NO_DELIVERY_WAITING";
      throw err;
    }

    // 3. Fetch ChickenDelivery
    const delivery = await tx.chickenDelivery.findUnique({
      where: { id: turn.pendingDeliveryId },
      include: { broughtBy: true },
    });

    if (!delivery || delivery.status !== "WAITING_FOR_APPROVAL") {
      const err = new Error("This chicken delivery has already been approved.");
      err.status = 409;
      err.code = "ALREADY_APPROVED";
      throw err;
    }

    // 4. Submitter cannot approve their own delivery
    if (delivery.broughtById === approverUserId) {
      const err = new Error("You cannot approve your own chicken delivery.");
      err.status = 403;
      err.code = "CANNOT_APPROVE_OWN_DELIVERY";
      throw err;
    }

    // 5. Concurrency protection: Atomic conditional update prevents simultaneous double-approvals
    const updateResult = await tx.chickenDelivery.updateMany({
      where: {
        id: delivery.id,
        status: "WAITING_FOR_APPROVAL",
      },
      data: {
        status: "APPROVED",
        approvedById: approverUserId,
        approvedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      const err = new Error("This chicken delivery has already been approved.");
      err.status = 409;
      err.code = "ALREADY_APPROVED";
      throw err;
    }

    // 6. Calculate next Chicken Turn member
    const members = await tx.groupMember.findMany({
      where: { groupId },
      orderBy: { turnOrder: "asc" },
      include: { user: true },
    });

    if (members.length === 0) {
      await tx.chickenTurn.update({
        where: { id: turn.id },
        data: {
          currentUserId: null,
          status: "WAITING_FOR_COMPLETION",
          pendingDeliveryId: null,
        },
      });
      return { success: true, nextTurn: null };
    }

    const currentIndex = members.findIndex((m) => m.userId === delivery.broughtById);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % members.length;
    const nextMember = members[nextIndex];

    // 7. Advance Chicken Turn
    await tx.chickenTurn.update({
      where: { id: turn.id },
      data: {
        currentUserId: nextMember.userId,
        status: "WAITING_FOR_COMPLETION",
        pendingDeliveryId: null,
      },
    });

    return {
      message: "Chicken delivery approved successfully!",
      approvedDelivery: {
        id: delivery.id,
        groupId: delivery.groupId,
        broughtById: delivery.broughtById,
        broughtByName: delivery.broughtBy?.name,
        completedAt: delivery.completedAt,
        approvedById: approverUserId,
        approvedByName: membership.user.name,
        approvedAt: new Date(),
        status: "APPROVED",
      },
      nextTurn: {
        userId: nextMember.userId,
        name: nextMember.user.name,
      },
    };
  });
}

/**
 * Returns paginated Chicken delivery history.
 */
async function getChickenHistory(groupId, page = 1, pageSize = 20) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safePageSize = Math.min(parseInt(pageSize, 10) || 20, 50);

  const [deliveries, total] = await Promise.all([
    prisma.chickenDelivery.findMany({
      where: { groupId, status: "APPROVED" },
      include: { broughtBy: true, approvedBy: true },
      orderBy: { completedAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.chickenDelivery.count({ where: { groupId, status: "APPROVED" } }),
  ]);

  return {
    records: deliveries.map((d) => ({
      id: d.id,
      groupId: d.groupId,
      broughtById: d.broughtById,
      broughtByName: d.broughtBy?.name || "Member",
      completedAt: d.completedAt,
      approvedById: d.approvedById,
      approvedByName: d.approvedBy?.name || "Member",
      approvedAt: d.approvedAt,
      status: d.status,
    })),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: Math.ceil(total / safePageSize),
  };
}

/**
 * Handles member leave events for Chicken Turn:
 * - Removes leaving member from future Chicken rotation.
 * - Previous Chicken History is preserved.
 * - If leaving member currently holds the chicken turn, advances to next valid member.
 * - Never leaves a deleted/non-existent member as the current Chicken Turn.
 */
async function handleMemberLeaveChickenTurn(tx, groupId, leavingUserId) {
  const chickenTurn = await tx.chickenTurn.findUnique({
    where: { groupId },
    include: { pendingDelivery: true },
  });

  if (!chickenTurn) return;

  const remainingMembers = await tx.groupMember.findMany({
    where: { groupId, userId: { not: leavingUserId } },
    orderBy: { turnOrder: "asc" },
  });

  if (remainingMembers.length === 0) {
    await tx.chickenTurn.update({
      where: { id: chickenTurn.id },
      data: {
        currentUserId: null,
        status: "WAITING_FOR_COMPLETION",
        pendingDeliveryId: null,
      },
    });
    return;
  }

  if (chickenTurn.currentUserId === leavingUserId) {
    const leavingMember = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: leavingUserId } },
    });
    const leavingTurnOrder = leavingMember ? leavingMember.turnOrder : 0;

    const nextIndex = remainingMembers.findIndex((m) => m.turnOrder > leavingTurnOrder);
    const nextMember = nextIndex === -1 ? remainingMembers[0] : remainingMembers[nextIndex];

    // If leaving member was waiting for approval on their delivery, cancel the pending delivery
    if (chickenTurn.status === "WAITING_FOR_APPROVAL" && chickenTurn.pendingDeliveryId) {
      await tx.chickenDelivery.delete({
        where: { id: chickenTurn.pendingDeliveryId },
      }).catch(() => {});
    }

    await tx.chickenTurn.update({
      where: { id: chickenTurn.id },
      data: {
        currentUserId: nextMember.userId,
        status: "WAITING_FOR_COMPLETION",
        pendingDeliveryId: null,
      },
    });
  }
}

module.exports = {
  getOrCreateChickenTurn,
  getChickenStatus,
  markChickenDone,
  approveChickenDelivery,
  getChickenHistory,
  handleMemberLeaveChickenTurn,
};
