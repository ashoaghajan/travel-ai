-- AlterTable
--
-- Every existing account lands on 'free', this one included. Grandfathering
-- them to 'pro' would leave the free planner untested by the only people in a
-- position to notice it being bad, and one click puts an account back.
ALTER TABLE "User" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "proSince" TIMESTAMP(3);
