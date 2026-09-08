-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "categoryWeights" JSONB,
ADD COLUMN     "dailyActivityBudget" INTEGER,
ADD COLUMN     "dayEnd" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "dayStart" TEXT NOT NULL DEFAULT '09:30',
ADD COLUMN     "dinner" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lunch" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxActivityPrice" INTEGER,
ADD COLUMN     "pace" TEXT NOT NULL DEFAULT 'balanced';
