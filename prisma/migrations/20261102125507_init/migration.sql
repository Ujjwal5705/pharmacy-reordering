-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'PHARMACIST', 'STORE_STAFF', 'OPS_ADMIN');

-- CreateEnum
CREATE TYPE "Relation" AS ENUM ('SELF', 'MOTHER', 'FATHER', 'SPOUSE', 'CHILD', 'SIBLING', 'GRANDPARENT', 'OTHER');

-- CreateEnum
CREATE TYPE "MedicineCategory" AS ENUM ('OTC', 'SCHEDULE_H', 'SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PHARMACIST', 'NEEDS_REUPLOAD', 'AWAITING_CUSTOMER_CONSENT', 'APPROVED', 'REJECTED', 'PICKING', 'PACKED', 'HANDED_TO_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoutingStatus" AS ENUM ('NOT_ROUTED', 'ROUTED', 'NO_STOCK');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('CATALOGUE', 'REORDER', 'REFILL_REMINDER');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING_REVIEW', 'NOT_REQUIRED', 'APPROVED', 'REJECTED', 'AWAITING_CONSENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI_TEST', 'COD_TEST');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('TEST_PAID', 'TEST_REFUNDED', 'COD_PENDING', 'COD_COLLECTED', 'VOID');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('SUCCEEDED', 'LOW_CONFIDENCE', 'UNREADABLE', 'FAILED', 'UNSUPPORTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHED', 'AMBIGUOUS', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'REUPLOAD_REQUESTED', 'SUBSTITUTION_PROPOSED');

-- CreateEnum
CREATE TYPE "ItemDecision" AS ENUM ('APPROVE', 'REJECT', 'PROPOSE_SUBSTITUTE');

-- CreateEnum
CREATE TYPE "SubstitutionStatus" AS ENUM ('PENDING_CONSENT', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('GENERIC_SUBSTITUTION', 'REFILL_REMINDERS');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('IN_APP', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "RefillPlanStatus" AS ENUM ('ACTIVE', 'NEEDS_DOSAGE', 'AWAITING_DELIVERY');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'APPLIED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'ERROR', 'DUPLICATE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "storeId" TEXT,
    "pharmacistRegNo" TEXT,
    "defaultLocalityId" TEXT,
    "addressLine" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" "Relation" NOT NULL,
    "yearOfBirth" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Locality" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,

    CONSTRAINT "Locality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "molecule" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "packLabel" TEXT NOT NULL,
    "unitsPerPack" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "category" "MedicineCategory" NOT NULL,
    "isGeneric" BOOLEAN NOT NULL DEFAULT true,
    "genericGroup" TEXT,
    "manufacturer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicinePolicy" (
    "id" TEXT NOT NULL,
    "category" "MedicineCategory" NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "onlineOrderable" BOOLEAN NOT NULL,
    "prescriptionRequired" BOOLEAN NOT NULL,
    "pharmacistApprovalRequired" BOOLEAN NOT NULL,
    "h1RegisterRequired" BOOLEAN NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicinePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "lastBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "StockImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "storeCode" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER,
    "status" "ImportRowStatus" NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "StockImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "source" "OrderSource" NOT NULL DEFAULT 'CATALOGUE',
    "routingStatus" "RoutingStatus" NOT NULL DEFAULT 'NOT_ROUTED',
    "storeId" TEXT,
    "distanceKm" DECIMAL(6,2),
    "deliveryLocalityId" TEXT NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "requiresPharmacist" BOOLEAN NOT NULL,
    "manualReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "prescriptionId" TEXT,
    "rejectionReason" TEXT,
    "storeInvoiceNumber" TEXT,
    "deliveryPartner" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstDecisionAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "routedAt" TIMESTAMP(3),
    "pickedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "handedOverAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "approvedQuantity" INTEGER,
    "unitPricePaise" INTEGER NOT NULL,
    "status" "OrderItemStatus" NOT NULL,
    "category" "MedicineCategory" NOT NULL,
    "policyId" TEXT NOT NULL,
    "prescriptionRequired" BOOLEAN NOT NULL,
    "pharmacistApprovalRequired" BOOLEAN NOT NULL,
    "h1RegisterRequired" BOOLEAN NOT NULL,
    "dosageInstruction" TEXT,
    "unitsPerDay" DECIMAL(6,2),
    "approvedByReviewId" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "testReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "cipherSha256" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL,
    "overallConfidence" DECIMAL(4,3),
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT,
    "confidence" DECIMAL(4,3) NOT NULL,

    CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "medicineName" TEXT,
    "nameConfidence" DECIMAL(4,3) NOT NULL,
    "strength" TEXT,
    "strengthConfidence" DECIMAL(4,3) NOT NULL,
    "form" TEXT,
    "dosageText" TEXT,
    "unitsPerDay" DECIMAL(6,2),
    "dosageConfidence" DECIMAL(4,3) NOT NULL,
    "durationDays" INTEGER,
    "durationConfidence" DECIMAL(4,3) NOT NULL,
    "quantityUnits" INTEGER,
    "quantityConfidence" DECIMAL(4,3) NOT NULL,
    "quantityDerived" BOOLEAN NOT NULL DEFAULT false,
    "matchStatus" "MatchStatus" NOT NULL,
    "matchedProductId" TEXT,
    "matchScore" DECIMAL(4,3),
    "matchReason" TEXT,
    "candidates" JSONB,

    CONSTRAINT "ExtractedLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PharmacistReview" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "prescriptionId" TEXT,
    "extractionRunId" TEXT,
    "reviewerId" TEXT NOT NULL,
    "reviewerRegNo" TEXT NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "reason" TEXT,
    "patientName" TEXT,
    "prescriberName" TEXT,
    "prescriberRegNo" TEXT,
    "prescriptionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PharmacistReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItemDecision" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "decision" "ItemDecision" NOT NULL,
    "approvedQuantity" INTEGER,
    "dosageInstruction" TEXT,
    "unitsPerDay" DECIMAL(6,2),
    "reason" TEXT,
    "substituteProductId" TEXT,

    CONSTRAINT "ReviewItemDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "H1RegisterEntry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientAddress" TEXT NOT NULL,
    "prescriberName" TEXT NOT NULL,
    "prescriberAddress" TEXT NOT NULL,
    "prescriberRegNo" TEXT,
    "prescriptionDate" TIMESTAMP(3) NOT NULL,
    "quantitySupplied" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "H1RegisterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstitutionProposal" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "originalProductId" TEXT NOT NULL,
    "substituteProductId" TEXT NOT NULL,
    "proposedById" TEXT NOT NULL,
    "status" "SubstitutionStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
    "consentId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubstitutionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "channel" "Channel",
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefillPlan" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceOrderId" TEXT NOT NULL,
    "sourceOrderItemId" TEXT NOT NULL,
    "packsSupplied" INTEGER NOT NULL,
    "unitsSupplied" INTEGER NOT NULL,
    "unitsPerDay" DECIMAL(6,2),
    "startDate" TIMESTAMP(3),
    "runOutDate" TIMESTAMP(3),
    "remindAt" TIMESTAMP(3),
    "status" "RefillPlanStatus" NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "channel" "Channel" NOT NULL DEFAULT 'IN_APP',
    "lastReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefillPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON "OtpChallenge"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitHit_key_createdAt_idx" ON "RateLimitHit"("key", "createdAt");

-- CreateIndex
CREATE INDEX "FamilyMember_customerId_idx" ON "FamilyMember"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Locality_name_key" ON "Locality"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Store_code_key" ON "Store"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_molecule_idx" ON "Product"("molecule");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_genericGroup_idx" ON "Product"("genericGroup");

-- CreateIndex
CREATE INDEX "MedicinePolicy_category_effectiveFrom_idx" ON "MedicinePolicy"("category", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "MedicinePolicy_category_version_key" ON "MedicinePolicy"("category", "version");

-- CreateIndex
CREATE INDEX "InventoryItem_productId_idx" ON "InventoryItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_storeId_productId_key" ON "InventoryItem"("storeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockImportRow_batchId_rowNumber_key" ON "StockImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "StockReservation_orderId_idx" ON "StockReservation"("orderId");

-- CreateIndex
CREATE INDEX "StockReservation_orderItemId_status_idx" ON "StockReservation"("orderItemId", "status");

-- CreateIndex
CREATE INDEX "CartItem_customerId_idx" ON "CartItem"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_familyMemberId_productId_key" ON "CartItem"("familyMemberId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_storeId_status_idx" ON "Order"("storeId", "status");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_createdAt_idx" ON "OrderStatusEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_orderId_key" ON "PaymentRecord"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_storageKey_key" ON "Prescription"("storageKey");

-- CreateIndex
CREATE INDEX "Prescription_customerId_familyMemberId_idx" ON "Prescription"("customerId", "familyMemberId");

-- CreateIndex
CREATE INDEX "ExtractionRun_prescriptionId_createdAt_idx" ON "ExtractionRun"("prescriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedField_runId_key_key" ON "ExtractedField"("runId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedLine_runId_lineIndex_key" ON "ExtractedLine"("runId", "lineIndex");

-- CreateIndex
CREATE INDEX "PharmacistReview_orderId_createdAt_idx" ON "PharmacistReview"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewItemDecision_reviewId_orderItemId_key" ON "ReviewItemDecision"("reviewId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "H1RegisterEntry_orderItemId_key" ON "H1RegisterEntry"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SubstitutionProposal_consentId_key" ON "SubstitutionProposal"("consentId");

-- CreateIndex
CREATE INDEX "SubstitutionProposal_orderId_status_idx" ON "SubstitutionProposal"("orderId", "status");

-- CreateIndex
CREATE INDEX "Consent_customerId_type_idx" ON "Consent"("customerId", "type");

-- CreateIndex
CREATE INDEX "Consent_subjectType_subjectId_idx" ON "Consent"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "RefillPlan_sourceOrderItemId_key" ON "RefillPlan"("sourceOrderItemId");

-- CreateIndex
CREATE INDEX "RefillPlan_customerId_optedIn_idx" ON "RefillPlan"("customerId", "optedIn");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultLocalityId_fkey" FOREIGN KEY ("defaultLocalityId") REFERENCES "Locality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicinePolicy" ADD CONSTRAINT "MedicinePolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_lastBatchId_fkey" FOREIGN KEY ("lastBatchId") REFERENCES "StockImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockImportBatch" ADD CONSTRAINT "StockImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockImportRow" ADD CONSTRAINT "StockImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryLocalityId_fkey" FOREIGN KEY ("deliveryLocalityId") REFERENCES "Locality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_requestedProductId_fkey" FOREIGN KEY ("requestedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "MedicinePolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedLine" ADD CONSTRAINT "ExtractedLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedLine" ADD CONSTRAINT "ExtractedLine_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistReview" ADD CONSTRAINT "PharmacistReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistReview" ADD CONSTRAINT "PharmacistReview_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistReview" ADD CONSTRAINT "PharmacistReview_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "ExtractionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacistReview" ADD CONSTRAINT "PharmacistReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItemDecision" ADD CONSTRAINT "ReviewItemDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PharmacistReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItemDecision" ADD CONSTRAINT "ReviewItemDecision_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItemDecision" ADD CONSTRAINT "ReviewItemDecision_substituteProductId_fkey" FOREIGN KEY ("substituteProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "H1RegisterEntry" ADD CONSTRAINT "H1RegisterEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "H1RegisterEntry" ADD CONSTRAINT "H1RegisterEntry_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "H1RegisterEntry" ADD CONSTRAINT "H1RegisterEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "H1RegisterEntry" ADD CONSTRAINT "H1RegisterEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionProposal" ADD CONSTRAINT "SubstitutionProposal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionProposal" ADD CONSTRAINT "SubstitutionProposal_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionProposal" ADD CONSTRAINT "SubstitutionProposal_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PharmacistReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionProposal" ADD CONSTRAINT "SubstitutionProposal_originalProductId_fkey" FOREIGN KEY ("originalProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionProposal" ADD CONSTRAINT "SubstitutionProposal_substituteProductId_fkey" FOREIGN KEY ("substituteProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionProposal" ADD CONSTRAINT "SubstitutionProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstitutionProposal" ADD CONSTRAINT "SubstitutionProposal_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "Consent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillPlan" ADD CONSTRAINT "RefillPlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillPlan" ADD CONSTRAINT "RefillPlan_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillPlan" ADD CONSTRAINT "RefillPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillPlan" ADD CONSTRAINT "RefillPlan_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillPlan" ADD CONSTRAINT "RefillPlan_sourceOrderItemId_fkey" FOREIGN KEY ("sourceOrderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
