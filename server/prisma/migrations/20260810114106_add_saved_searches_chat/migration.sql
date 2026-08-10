-- CreateTable
CREATE TABLE "SavedActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "activity" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'flight',
    "query" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "searchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatHistory" (
    "userId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatHistory_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "SavedActivity_userId_savedAt_idx" ON "SavedActivity"("userId", "savedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SavedActivity_userId_activityId_key" ON "SavedActivity"("userId", "activityId");

-- CreateIndex
CREATE INDEX "RecentSearch_userId_searchedAt_idx" ON "RecentSearch"("userId", "searchedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RecentSearch_userId_kind_fingerprint_key" ON "RecentSearch"("userId", "kind", "fingerprint");

-- AddForeignKey
ALTER TABLE "SavedActivity" ADD CONSTRAINT "SavedActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentSearch" ADD CONSTRAINT "RecentSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatHistory" ADD CONSTRAINT "ChatHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
