-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "refillReminders" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockImportRow" ADD COLUMN     "rawQuantity" TEXT;
