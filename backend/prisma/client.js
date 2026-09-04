const { PrismaClient } = require("@prisma/client");

// In serverless environments like Vercel, reuse PrismaClient across invocations
// to avoid creating redundant connection pools and exhausting database connections.
const globalForPrisma = globalThis;

let runtimeDbUrl = process.env.DATABASE_URL || "";

// If DATABASE_URL is pointing to Supabase pooler on port 5432, automatically route to
// port 6543 with pgbouncer=true so serverless Lambda queries never exhaust connections or time out.
if (runtimeDbUrl.includes("pooler.supabase.com:5432")) {
  runtimeDbUrl = runtimeDbUrl.replace(":5432", ":6543");
  if (!runtimeDbUrl.includes("pgbouncer=true")) {
    runtimeDbUrl += (runtimeDbUrl.includes("?") ? "&" : "?") + "pgbouncer=true";
  }
}

// Make sure DIRECT_URL exists for migrations/schema
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL.replace(":6543", ":5432").replace("?pgbouncer=true", "");
}

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: runtimeDbUrl ? { db: { url: runtimeDbUrl } } : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;

module.exports = prisma;
