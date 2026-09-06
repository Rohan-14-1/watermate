-- Migration: 20260907_chicken_turn
-- Purpose: Add ChickenTurn and ChickenDelivery models decoupled from WaterTurn

-- Create chicken_turns table
CREATE TABLE IF NOT EXISTS "chicken_turns" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "currentUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING_FOR_COMPLETION',
    "pendingDeliveryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chicken_turns_pkey" PRIMARY KEY ("id")
);

-- Create chicken_deliveries table
CREATE TABLE IF NOT EXISTS "chicken_deliveries" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "broughtById" TEXT NOT NULL,
    "approvedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING_FOR_APPROVAL',
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chicken_deliveries_pkey" PRIMARY KEY ("id")
);

-- Unique & indices
CREATE UNIQUE INDEX IF NOT EXISTS "chicken_turns_groupId_key" ON "chicken_turns"("groupId");
CREATE INDEX IF NOT EXISTS "chicken_turns_groupId_idx" ON "chicken_turns"("groupId");

CREATE INDEX IF NOT EXISTS "chicken_deliveries_groupId_createdAt_idx" ON "chicken_deliveries"("groupId", "createdAt");
CREATE INDEX IF NOT EXISTS "chicken_deliveries_groupId_status_idx" ON "chicken_deliveries"("groupId", "status");

-- Foreign key constraints
ALTER TABLE "chicken_turns" DROP CONSTRAINT IF EXISTS "chicken_turns_groupId_fkey";
ALTER TABLE "chicken_turns" ADD CONSTRAINT "chicken_turns_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chicken_turns" DROP CONSTRAINT IF EXISTS "chicken_turns_currentUserId_fkey";
ALTER TABLE "chicken_turns" ADD CONSTRAINT "chicken_turns_currentUserId_fkey" FOREIGN KEY ("currentUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chicken_turns" DROP CONSTRAINT IF EXISTS "chicken_turns_pendingDeliveryId_fkey";
ALTER TABLE "chicken_turns" ADD CONSTRAINT "chicken_turns_pendingDeliveryId_fkey" FOREIGN KEY ("pendingDeliveryId") REFERENCES "chicken_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chicken_deliveries" DROP CONSTRAINT IF EXISTS "chicken_deliveries_groupId_fkey";
ALTER TABLE "chicken_deliveries" ADD CONSTRAINT "chicken_deliveries_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chicken_deliveries" DROP CONSTRAINT IF EXISTS "chicken_deliveries_broughtById_fkey";
ALTER TABLE "chicken_deliveries" ADD CONSTRAINT "chicken_deliveries_broughtById_fkey" FOREIGN KEY ("broughtById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chicken_deliveries" DROP CONSTRAINT IF EXISTS "chicken_deliveries_approvedById_fkey";
ALTER TABLE "chicken_deliveries" ADD CONSTRAINT "chicken_deliveries_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
