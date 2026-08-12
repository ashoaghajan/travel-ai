-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN     "shareId" TEXT;

-- CreateTable
CREATE TABLE "TripShare" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "tripId" TEXT,
    "snapshot" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "dayCount" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedTripId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripShare_toUserId_createdAt_idx" ON "TripShare"("toUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DirectMessage_shareId_key" ON "DirectMessage"("shareId");

-- AddForeignKey
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "TripShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripShare" ADD CONSTRAINT "TripShare_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripShare" ADD CONSTRAINT "TripShare_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripShare" ADD CONSTRAINT "TripShare_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

