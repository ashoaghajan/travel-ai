-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeTripId" TEXT;

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "draftId" TEXT,
    "title" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "destinationCountry" TEXT,
    "destinationCity" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "travellers" INTEGER NOT NULL,
    "coverImage" TEXT NOT NULL,
    "itinerary" JSONB NOT NULL,
    "flightsEstimate" DOUBLE PRECISION,
    "hotelsEstimate" DOUBLE PRECISION,
    "activitiesEstimate" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trip_userId_createdAt_idx" ON "Trip"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Trip_userId_draftId_key" ON "Trip"("userId", "draftId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeTripId_fkey" FOREIGN KEY ("activeTripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
