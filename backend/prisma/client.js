const { PrismaClient } = require("@prisma/client");

// In serverless environments like Vercel, reuse PrismaClient across invocations
// to avoid creating redundant connection pools and exhausting database connections.
const globalForPrisma = globalThis;

// If DIRECT_URL is needed by schema but not set, derive from DATABASE_URL
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL.replace(":6543", ":5432").replace("?pgbouncer=true", "");
}

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;

module.exports = prisma;
