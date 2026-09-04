const { execSync } = require("child_process");

console.log("\n=================================");
console.log("💧 WaterMate Build: Database & Client Setup");
console.log("=================================\n");

// 1. Generate Prisma Client
try {
  console.log("Generating Prisma client...");
  execSync("npx prisma generate --schema=backend/prisma/schema.prisma", { stdio: "inherit" });
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
    execSync("npx prisma migrate deploy --schema=backend/prisma/schema.prisma", { stdio: "inherit" });
    console.log("Database migrations applied successfully.");
  } catch (err) {
    console.warn("prisma migrate deploy failed. Falling back to prisma db push...", err.message);
    try {
      execSync("npx prisma db push --schema=backend/prisma/schema.prisma --accept-data-loss", { stdio: "inherit" });
      console.log("Database schema pushed successfully.");
    } catch (pushErr) {
      console.warn("Automatic database migration/push could not complete during build:", pushErr.message);
      console.warn("Please verify that your database allows connections from Vercel build servers.");
    }
  }
} else {
  console.log("\nℹ️  Notice: No remote DATABASE_URL provided (or set to localhost).");
  console.log("   To run the database on Vercel:");
  console.log("   1. Create a free PostgreSQL database (e.g. Neon, Supabase, Vercel Postgres, Railway)");
  console.log("   2. Add DATABASE_URL to your Vercel Project Settings > Environment Variables");
  console.log("   3. Redeploy your project.");
}
console.log("\n=================================\n");
