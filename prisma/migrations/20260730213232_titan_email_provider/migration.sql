-- AlterEnum
ALTER TYPE "ProviderKind" ADD VALUE 'TITAN';

-- AlterTable
ALTER TABLE "ProviderConnection" ALTER COLUMN "encryptedRefreshToken" DROP NOT NULL,
ALTER COLUMN "tokenExpiresAt" DROP NOT NULL;
