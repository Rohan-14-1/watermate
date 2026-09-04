const { PrismaClient } = require("@prisma/client");

// In serverless environments like Vercel, module-level variables are cached
// across warm invocations. Attach prisma to globalThis to reuse connection
// pools and avoid exhausting database connections.
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
