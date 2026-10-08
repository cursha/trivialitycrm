-- Saved Quick Search city lists.
CREATE TABLE "CityList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "cities" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CityList_name_key" ON "CityList"("name");

ALTER TABLE "CityList" ADD CONSTRAINT "CityList_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
