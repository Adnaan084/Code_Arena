-- CreateEnum
CREATE TYPE "GameState" AS ENUM ('LOBBY', 'MARKET_OPEN', 'FINAL_MINUTE', 'MARKET_CLOSED', 'FINAL_SCORING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'OUTPUT_PREDICTION', 'WILL_IT_COMPILE', 'FIND_ERROR', 'FIND_UB', 'SHORT_ANSWER', 'CODE_CORRECTION', 'CODING_CHALLENGE');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXTREME');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('AVAILABLE', 'SOLD', 'DISABLED');

-- CreateEnum
CREATE TYPE "OwnershipStatus" AS ENUM ('UNSOLVED', 'SOLVED', 'FAILED');

-- CreateEnum
CREATE TYPE "TradeState" AS ENUM ('OPEN', 'EXECUTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GameEventType" AS ENUM ('GAME_STARTED', 'GAME_PAUSED', 'GAME_RESUMED', 'MARKET_OPENED', 'MARKET_CLOSED', 'GAME_COMPLETED', 'TEAM_JOINED', 'TEAM_DISQUALIFIED', 'TEAM_CONNECTED', 'TEAM_DISCONNECTED', 'QUESTION_ADDED', 'QUESTION_ENABLED', 'QUESTION_DISABLED', 'QUESTION_PURCHASED', 'QUESTION_SOLVED', 'QUESTION_FAILED', 'TRADE_CREATED', 'TRADE_ACCEPTED', 'TRADE_REJECTED', 'TRADE_CANCELLED', 'TRADE_EXPIRED', 'ANNOUNCEMENT_CREATED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INITIAL', 'PURCHASE', 'REFUND', 'REWARD', 'TRADE_OUT', 'TRADE_IN', 'BONUS', 'PENALTY', 'ADMIN_ADJUST');

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" "GameState" NOT NULL DEFAULT 'LOBBY',
    "config" JSONB NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedTotalMs" INTEGER NOT NULL DEFAULT 0,
    "hostTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rewardsEarned" INTEGER NOT NULL DEFAULT 0,
    "solvedCount" INTEGER NOT NULL DEFAULT 0,
    "purchasedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "online" BOOLEAN NOT NULL DEFAULT false,
    "disconnectedAt" TIMESTAMP(3),
    "joinOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "playerName" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "codeSnippet" TEXT,
    "answerData" JSONB NOT NULL,
    "price" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "hint" TEXT,
    "explanation" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "QuestionStatus" NOT NULL DEFAULT 'AVAILABLE',
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "maxTrades" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOwnership" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "status" "OwnershipStatus" NOT NULL DEFAULT 'UNSOLVED',
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "tradeLock" BOOLEAN NOT NULL DEFAULT false,
    "purchasePrice" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "pricePaid" INTEGER NOT NULL,
    "reward" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "ownershipId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "answer" JSONB NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "coinsAwarded" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "fromTeamId" TEXT NOT NULL,
    "toTeamId" TEXT NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 0,
    "state" "TradeState" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeItem" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,

    CONSTRAINT "TradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "questionCode" TEXT,
    "tradeId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" BIGSERIAL NOT NULL,
    "gameId" TEXT NOT NULL,
    "type" "GameEventType" NOT NULL,
    "teamId" TEXT,
    "questionCode" TEXT,
    "payload" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Game_code_key" ON "Game"("code");

-- CreateIndex
CREATE INDEX "Team_gameId_idx" ON "Team"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_gameId_name_key" ON "Team"("gameId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_seat_key" ON "TeamMember"("teamId", "seat");

-- CreateIndex
CREATE INDEX "Question_gameId_status_idx" ON "Question"("gameId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Question_gameId_code_key" ON "Question"("gameId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOwnership_questionId_key" ON "QuestionOwnership"("questionId");

-- CreateIndex
CREATE INDEX "QuestionOwnership_teamId_idx" ON "QuestionOwnership"("teamId");

-- CreateIndex
CREATE INDEX "QuestionOwnership_gameId_idx" ON "QuestionOwnership"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_questionId_key" ON "Purchase"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_teamId_idempotencyKey_key" ON "Purchase"("teamId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Submission_teamId_questionId_idx" ON "Submission"("teamId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_teamId_idempotencyKey_key" ON "Submission"("teamId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Trade_gameId_state_idx" ON "Trade"("gameId", "state");

-- CreateIndex
CREATE INDEX "Trade_toTeamId_state_idx" ON "Trade"("toTeamId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_gameId_fromTeamId_idempotencyKey_key" ON "Trade"("gameId", "fromTeamId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TradeItem_tradeId_role_questionId_key" ON "TradeItem"("tradeId", "role", "questionId");

-- CreateIndex
CREATE INDEX "Transaction_teamId_createdAt_idx" ON "Transaction"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_gameId_createdAt_idx" ON "Transaction"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "GameEvent_gameId_id_idx" ON "GameEvent"("gameId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_gameId_createdAt_idx" ON "AuditLog"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_gameId_createdAt_idx" ON "Announcement"("gameId", "createdAt");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOwnership" ADD CONSTRAINT "QuestionOwnership_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOwnership" ADD CONSTRAINT "QuestionOwnership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOwnership" ADD CONSTRAINT "QuestionOwnership_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_ownershipId_fkey" FOREIGN KEY ("ownershipId") REFERENCES "QuestionOwnership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_fromTeamId_fkey" FOREIGN KEY ("fromTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_toTeamId_fkey" FOREIGN KEY ("toTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
