-- Migration: 20260908_uno_multiplayer
-- Purpose: Add UnoGame and UnoPlayer models for WaterMate Multiplayer UNO Game

-- CreateTable uno_games
CREATE TABLE IF NOT EXISTS "uno_games" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "direction" INTEGER NOT NULL DEFAULT 1,
    "currentColor" TEXT,
    "topDiscardCard" JSONB,
    "discardPile" JSONB NOT NULL DEFAULT '[]',
    "drawPile" JSONB NOT NULL DEFAULT '[]',
    "currentPlayerId" TEXT,
    "turnNumber" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "winnerId" TEXT,
    "lastAction" JSONB,
    "hasDrawnThisTurn" BOOLEAN NOT NULL DEFAULT false,
    "drawnCardPlayable" BOOLEAN NOT NULL DEFAULT false,
    "unoCallWindow" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uno_games_pkey" PRIMARY KEY ("id")
);

-- CreateTable uno_players
CREATE TABLE IF NOT EXISTS "uno_players" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "cards" JSONB NOT NULL DEFAULT '[]',
    "cardCount" INTEGER NOT NULL DEFAULT 0,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "hasCalledUno" BOOLEAN NOT NULL DEFAULT false,
    "unoSafe" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uno_players_pkey" PRIMARY KEY ("id")
);

-- Indexes & Unique constraints
CREATE INDEX IF NOT EXISTS "uno_games_groupId_status_idx" ON "uno_games"("groupId", "status");
CREATE INDEX IF NOT EXISTS "uno_games_creatorId_idx" ON "uno_games"("creatorId");
CREATE INDEX IF NOT EXISTS "uno_games_winnerId_idx" ON "uno_games"("winnerId");

CREATE UNIQUE INDEX IF NOT EXISTS "uno_players_gameId_userId_key" ON "uno_players"("gameId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "uno_players_gameId_order_key" ON "uno_players"("gameId", "order");
CREATE INDEX IF NOT EXISTS "uno_players_gameId_idx" ON "uno_players"("gameId");
CREATE INDEX IF NOT EXISTS "uno_players_userId_idx" ON "uno_players"("userId");

-- Foreign key constraints
ALTER TABLE "uno_games" DROP CONSTRAINT IF EXISTS "uno_games_groupId_fkey";
ALTER TABLE "uno_games" ADD CONSTRAINT "uno_games_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "uno_games" DROP CONSTRAINT IF EXISTS "uno_games_creatorId_fkey";
ALTER TABLE "uno_games" ADD CONSTRAINT "uno_games_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "uno_games" DROP CONSTRAINT IF EXISTS "uno_games_winnerId_fkey";
ALTER TABLE "uno_games" ADD CONSTRAINT "uno_games_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "uno_players" DROP CONSTRAINT IF EXISTS "uno_players_gameId_fkey";
ALTER TABLE "uno_players" ADD CONSTRAINT "uno_players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "uno_games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "uno_players" DROP CONSTRAINT IF EXISTS "uno_players_userId_fkey";
ALTER TABLE "uno_players" ADD CONSTRAINT "uno_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
