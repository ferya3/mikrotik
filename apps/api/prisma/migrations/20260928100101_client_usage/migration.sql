-- CreateTable
CREATE TABLE "client_usage_daily" (
    "routerId" UUID NOT NULL,
    "clientKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "downloadBytes" BIGINT NOT NULL DEFAULT 0,
    "uploadBytes" BIGINT NOT NULL DEFAULT 0,
    "label" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_usage_daily_pkey" PRIMARY KEY ("routerId","clientKey","day")
);

-- CreateIndex
CREATE INDEX "client_usage_daily_routerId_day_idx" ON "client_usage_daily"("routerId", "day");

-- AddForeignKey
ALTER TABLE "client_usage_daily" ADD CONSTRAINT "client_usage_daily_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
