const crypto = require("crypto");
const prisma = require("../prisma/client");

/**
 * Returns the GroupMember row (with user info) that currently holds the
 * turn for a group, or null if the group has no members.
 */
async function getCurrentTurn(groupId) {
  return prisma.groupMember.findFirst({
    where: { groupId, isCurrentTurn: true },
    include: { user: true },
  });
}

/**
 * Given a group and the turnOrder of whoever just went, returns the
 * GroupMember that should go next. Wraps around to turnOrder 1 after the
 * highest turnOrder in the group, so the rotation is a continuous cycle.
 */
async function getNextMember(groupId, currentTurnOrder) {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    orderBy: { turnOrder: "asc" },
    include: { user: true },
  });

  if (members.length === 0) return null;
  if (members.length === 1) return members[0];

  const currentIndex = members.findIndex(
    (m) => m.turnOrder === currentTurnOrder
  );

  // If the current member wasn't found (e.g. was removed), fall back to
  // the first member in the rotation.
  if (currentIndex === -1) return members[0];

  const nextIndex = (currentIndex + 1) % members.length;
  return members[nextIndex];
}

/**
 * Moves the "current turn" flag from whoever holds it now to the next
 * member in the rotation. Runs inside a transaction so the group is never
 * left with zero or two members simultaneously marked as current.
 */
async function advanceTurn(groupId) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.groupMember.findFirst({
      where: { groupId, isCurrentTurn: true },
    });

    const members = await tx.groupMember.findMany({
      where: { groupId },
      orderBy: { turnOrder: "asc" },
    });

    if (members.length === 0) return null;

    let nextMember;
    if (!current) {
      nextMember = members[0];
    } else {
      const currentIndex = members.findIndex((m) => m.id === current.id);
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % members.length;
      nextMember = members[nextIndex];
    }

    if (current) {
      await tx.groupMember.update({
        where: { id: current.id },
        data: { isCurrentTurn: false },
      });
    }

    await tx.groupMember.update({
      where: { id: nextMember.id },
      data: { isCurrentTurn: true },
    });

    return tx.groupMember.findUnique({
      where: { id: nextMember.id },
      include: { user: true },
    });
  });

  try {
    const notificationService = require("./notificationService");
    notificationService.syncAndNotifyActiveTurn(groupId).catch(() => {});
  } catch (e) {}

  return result;
}

/**
 * Validates that it is this user's turn, records the WaterRecord with a
 * server-generated timestamp, and advances the rotation to the next
 * member - all inside one transaction so a delivery is never recorded
 * without the turn moving on (or vice versa).
 *
 * Throws an Error with a `.code` property that the controller maps to an
 * appropriate HTTP status.
 */
async function completeTurn(groupId, userId, photoUrl) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!membership) {
      const err = new Error("You are not a member of this group.");
      err.code = "NOT_A_MEMBER";
      throw err;
    }

    if (!membership.isCurrentTurn) {
      const err = new Error("It is not your turn yet.");
      err.code = "NOT_YOUR_TURN";
      throw err;
    }

    const record = await tx.waterRecord.create({
      data: { groupId, userId, photoUrl },
    });

    const members = await tx.groupMember.findMany({
      where: { groupId },
      orderBy: { turnOrder: "asc" },
    });

    const currentIndex = members.findIndex((m) => m.id === membership.id);
    const nextIndex = (currentIndex + 1) % members.length;
    const nextMember = members[nextIndex];

    await tx.groupMember.update({
      where: { id: membership.id },
      data: { isCurrentTurn: false },
    });

    await tx.groupMember.update({
      where: { id: nextMember.id },
      data: { isCurrentTurn: true },
    });

    const nextMemberWithUser = await tx.groupMember.findUnique({
      where: { id: nextMember.id },
      include: { user: true },
    });

    return { record, nextMember: nextMemberWithUser };
  });
}

/**
 * Generates a unique, human-shareable invite code like "WM4821" and
 * verifies it doesn't already exist before returning it.
 */
async function generateInviteCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const digits = crypto.randomInt(1000, 9999);
    const code = `WM${digits}`;
    const existing = await prisma.group.findUnique({
      where: { inviteCode: code },
    });
    if (!existing) return code;
  }
  // Extremely unlikely fallback with a longer random suffix.
  return `WM${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

module.exports = {
  getCurrentTurn,
  getNextMember,
  advanceTurn,
  completeTurn,
  generateInviteCode,
};
