const { PrismaClient } = require("@prisma/client");

// Reuse a single PrismaClient instance across the app instead of creating
// a new connection pool in every file that needs the database.
const prisma = new PrismaClient();

module.exports = prisma;
