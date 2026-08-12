-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_pairKey_key" ON "Friendship"("pairKey");

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");

-- CreateIndex
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


/*
  Everyone already talking is already a friend.

  Messaging shipped open to every account, so there are conversations in this
  database between people who never asked each other anything. The guard that
  arrives with this table would sever every one of them — a feature that
  quietly stops existing conversations is not one anybody asked for.

  So each distinct pair that has exchanged a message becomes an accepted
  friendship, dated from the first thing either of them said, with the first
  sender recorded as the one who asked. `ON CONFLICT DO NOTHING` makes it safe
  to re-run and safe against a row somebody creates between the CREATE above
  and this INSERT.
*/
INSERT INTO "Friendship" ("id", "pairKey", "requesterId", "addresseeId", "status", "createdAt", "respondedAt")
SELECT
  gen_random_uuid(),
  first."pairKey",
  first."senderId",
  first."recipientId",
  'accepted',
  first."createdAt",
  first."createdAt"
FROM (
  SELECT DISTINCT ON ("pairKey") "pairKey", "senderId", "recipientId", "createdAt"
  FROM "DirectMessage"
  ORDER BY "pairKey", "createdAt" ASC
) AS first
ON CONFLICT ("pairKey") DO NOTHING;
