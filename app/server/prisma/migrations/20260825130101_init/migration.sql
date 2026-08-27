-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phoneRaw" TEXT NOT NULL,
    "phoneE164" TEXT,
    "phoneValid" BOOLEAN NOT NULL DEFAULT false,
    "acquiredAt" DATETIME,
    "acquiredAtRaw" TEXT,
    "rating" INTEGER,
    "comment" TEXT,
    "sentimentLabel" TEXT NOT NULL DEFAULT 'neutral',
    "sentimentScore" REAL NOT NULL DEFAULT 0,
    "sentimentHash" TEXT,
    "optInWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "sheetRowKey" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SheetSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SheetSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "sheetId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Customer Sheet',
    "confirmedMapping" TEXT,
    "detectedMapping" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "cohortRule" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 10,
    "templateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "filtersSnapshot" TEXT,
    "selectionMode" TEXT NOT NULL DEFAULT 'none',
    "selectedIds" TEXT,
    "deselectedIds" TEXT,
    "selectionFilters" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "whatsappTemplateName" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en_US',
    "body" TEXT NOT NULL,
    "variables" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Delivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_sheetRowKey_key" ON "Customer"("sheetRowKey");

-- CreateIndex
CREATE INDEX "Customer_acquiredAt_idx" ON "Customer"("acquiredAt");

-- CreateIndex
CREATE INDEX "Customer_rating_idx" ON "Customer"("rating");

-- CreateIndex
CREATE INDEX "Customer_sentimentLabel_idx" ON "Customer"("sentimentLabel");

-- CreateIndex
CREATE INDEX "Customer_phoneE164_idx" ON "Customer"("phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "SheetSource_url_key" ON "SheetSource"("url");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_name_key" ON "MessageTemplate"("name");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_campaignId_customerId_key" ON "Delivery"("campaignId", "customerId");
