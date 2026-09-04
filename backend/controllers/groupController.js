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

module.exports = {
  createGroup,
  listMyGroups,
  getGroup,
  joinGroup,
  updateGroup,
};
