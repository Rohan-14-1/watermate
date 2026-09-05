const { execSync } = require("child_process");

console.log("\n=================================");
console.log("💧 WaterMate Build: Database & Client Setup");
console.log("=================================\n");

// Ensure DIRECT_URL is available for Prisma migrations if using transaction pooler
if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL.replace(":6543", ":5432").replace("?pgbouncer=true", "");
}

// 1. Generate Prisma Client
try {
  console.log("Generating Prisma client...");
  execSync("npx prisma generate --schema=backend/prisma/schema.prisma", {
    env: process.env,
    stdio: "inherit",
  });
  console.log("Prisma client generated successfully.");
} catch (err) {
  console.error("Prisma client generation failed:", err.message);
  process.exit(1);
}

// 2. Auto-migrate if a remote DATABASE_URL is configured
const dbUrl = process.env.DATABASE_URL;
if (dbUrl && !dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1")) {
  console.log("\nRemote DATABASE_URL detected. Applying migrations to database...");
  try {
    execSync("npx prisma migrate deploy --schema=backend/prisma/schema.prisma", { env: process.env, stdio: "inherit" });
    console.log("Database migrations applied successfully.");
  } catch (err) {
    console.warn("Prisma migrate deploy encountered an issue:", err.message);
    console.warn("Zero-destructive policy: Not running db push. Please review pending migrations.");
  }
} else {
  console.log("\nℹ️  Notice: No remote DATABASE_URL provided (or set to localhost).");
  console.log("   To run the database on Vercel:");
  console.log("   1. Create a free PostgreSQL database (e.g. Neon, Supabase, Vercel Postgres, Railway)");
  console.log("   2. Add DATABASE_URL to your Vercel Project Settings > Environment Variables");
  console.log("   3. Redeploy your project.");
}
console.log("\n=================================\n");
