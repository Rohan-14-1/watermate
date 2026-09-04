const prisma = require("../prisma/client");

/**
 * Verifies the logged-in user is a member of :groupId before allowing the
 * request to proceed. Attaches req.membership (this user's GroupMember row)
 * and req.group (the group) for downstream handlers to use, so nobody can
 * read or act on a group's private data without belonging to it.
 */
async function requireGroupMembership(req, res, next) {
  try {
    const { groupId } = req.params;

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) {
      return res.status(404).json({ message: "Group not found." });
    }

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.id } },
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: "You do not have access to this group." });
    }

    req.group = group;
    req.membership = membership;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Must run after requireGroupMembership. Restricts the action to the
 * group's creator/admin (e.g. reordering turns, removing members).
 */
function requireGroupAdmin(req, res, next) {
  if (req.group.createdBy !== req.user.id) {
    return res
      .status(403)
      .json({ message: "Only the group admin can do this." });
  }
  next();
}

module.exports = { requireGroupMembership, requireGroupAdmin };
