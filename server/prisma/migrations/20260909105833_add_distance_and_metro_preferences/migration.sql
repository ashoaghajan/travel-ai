-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "maxDistanceFromHotelKm" INTEGER,
ADD COLUMN     "nearMetroOnly" BOOLEAN NOT NULL DEFAULT false;
