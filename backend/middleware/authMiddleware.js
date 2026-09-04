const jwt = require("jsonwebtoken");
const prisma = require("../prisma/client");

/**
 * Verifies the JWT sent either as an httpOnly cookie ("token") or as an
 * Authorization: Bearer <token> header, and attaches the authenticated
 * user to req.user. Rejects the request if the token is missing/invalid
 * or the user no longer exists.
 */
async function requireAuth(req, res, next) {
  try {
    let token = req.cookies?.token;

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ message: "Please log in to continue." });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res
        .status(401)
        .json({ message: "Your session has expired. Please log in again." });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        profileImage: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({ message: "Please log in to continue." });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
