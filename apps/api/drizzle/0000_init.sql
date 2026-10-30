CREATE TABLE `api_keys` (
	`id` varchar(32) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`prefix` varchar(24) NOT NULL,
	`keyHash` varchar(64) NOT NULL,
	`scopes` longtext NOT NULL,
	`lastUsedAt` datetime(3),
	`revokedAt` datetime(3),
	`createdById` varchar(32),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_prefix_unique` UNIQUE(`prefix`),
	CONSTRAINT `api_keys_keyHash_unique` UNIQUE(`keyHash`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(32) NOT NULL,
	`actorId` varchar(32),
	`actorType` enum('SYSTEM','STAFF','BRAND','COURIER','CUSTOMER','API','INTEGRATION') NOT NULL,
	`action` varchar(100) NOT NULL,
	`entity` varchar(60) NOT NULL,
	`entityId` varchar(64),
	`before` longtext,
	`after` longtext,
	`ip` varchar(64),
	`userAgent` varchar(300),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brand_locations` (
	`id` varchar(32) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`contactName` varchar(120) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`addressLine` varchar(500) NOT NULL,
	`zoneId` varchar(32) NOT NULL,
	`lat` double,
	`lng` double,
	`isDefault` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `brand_locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` varchar(32) NOT NULL,
	`code` varchar(12) NOT NULL,
	`name` varchar(150) NOT NULL,
	`legalName` varchar(200),
	`commercialRegNo` varchar(50),
	`taxId` varchar(50),
	`industry` varchar(80),
	`logoUrl` varchar(500),
	`website` varchar(300),
	`email` varchar(191),
	`phone` varchar(20) NOT NULL,
	`status` enum('PENDING','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING',
	`pricingPlanId` varchar(32),
	`settlementCycle` enum('DAILY','WEEKLY','BIWEEKLY','MONTHLY') NOT NULL DEFAULT 'WEEKLY',
	`payoutMethod` enum('BANK_TRANSFER','INSTAPAY','VODAFONE_CASH','CASH','FAWRY','OTHER') NOT NULL DEFAULT 'BANK_TRANSFER',
	`payoutDetails` longtext,
	`allowOpenPackage` boolean NOT NULL DEFAULT false,
	`defaultFeesPaidBy` enum('BRAND','RECIPIENT') NOT NULL DEFAULT 'BRAND',
	`accountManagerId` varchar(32),
	`notes` text,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `brands_id` PRIMARY KEY(`id`),
	CONSTRAINT `brands_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `cash_handovers` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`hubId` varchar(32),
	`method` enum('CASH_AT_HUB','INSTAPAY','VODAFONE_CASH','BANK_TRANSFER','FAWRY') NOT NULL,
	`declaredCents` int NOT NULL,
	`receivedCents` int NOT NULL DEFAULT 0,
	`varianceCents` int NOT NULL DEFAULT 0,
	`reference` varchar(120),
	`proofUrl` varchar(500),
	`status` enum('PENDING','CONFIRMED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`notes` varchar(1000),
	`receivedById` varchar(32),
	`confirmedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `cash_handovers_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_handovers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `cities` (
	`id` varchar(32) NOT NULL,
	`governorateId` varchar(32) NOT NULL,
	`code` varchar(20) NOT NULL,
	`nameEn` varchar(100) NOT NULL,
	`nameAr` varchar(100) NOT NULL,
	CONSTRAINT `cities_id` PRIMARY KEY(`id`),
	CONSTRAINT `cities_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `courier_adjustments` (
	`id` varchar(32) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`type` enum('BONUS','PENALTY','CASH_SHORTAGE','ADVANCE','REIMBURSEMENT') NOT NULL,
	`amountCents` int NOT NULL,
	`reason` varchar(500) NOT NULL,
	`orderId` varchar(32),
	`payoutId` varchar(32),
	`createdById` varchar(32),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `courier_adjustments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `courier_documents` (
	`id` varchar(32) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`type` enum('NATIONAL_ID_FRONT','NATIONAL_ID_BACK','DRIVING_LICENSE','VEHICLE_LICENSE','CRIMINAL_RECORD','PERSONAL_PHOTO','CONTRACT','OTHER') NOT NULL,
	`url` varchar(500) NOT NULL,
	`status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`expiresAt` datetime(3),
	`reviewedById` varchar(32),
	`reviewNote` varchar(500),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `courier_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `courier_locations` (
	`id` varchar(32) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`accuracy` double,
	`speed` double,
	`heading` double,
	`battery` int,
	`recordedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `courier_locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `courier_payouts` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`periodStart` datetime(3) NOT NULL,
	`periodEnd` datetime(3) NOT NULL,
	`deliveriesCount` int NOT NULL DEFAULT 0,
	`pickupsCount` int NOT NULL DEFAULT 0,
	`failedAttemptsCount` int NOT NULL DEFAULT 0,
	`workedMinutes` int NOT NULL DEFAULT 0,
	`deliveryEarningsCents` int NOT NULL DEFAULT 0,
	`hourlyEarningsCents` int NOT NULL DEFAULT 0,
	`salaryCents` int NOT NULL DEFAULT 0,
	`bonusesCents` int NOT NULL DEFAULT 0,
	`deductionsCents` int NOT NULL DEFAULT 0,
	`netCents` int NOT NULL DEFAULT 0,
	`status` enum('DRAFT','APPROVED','PAID','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`method` enum('BANK_TRANSFER','INSTAPAY','VODAFONE_CASH','CASH','FAWRY','OTHER'),
	`paymentReference` varchar(120),
	`approvedById` varchar(32),
	`paidAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `courier_payouts_id` PRIMARY KEY(`id`),
	CONSTRAINT `courier_payouts_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `courier_zones` (
	`courierId` varchar(32) NOT NULL,
	`zoneId` varchar(32) NOT NULL,
	`isPrimary` boolean NOT NULL DEFAULT false,
	CONSTRAINT `courier_zones_courierId_zoneId_pk` PRIMARY KEY(`courierId`,`zoneId`)
);
--> statement-breakpoint
CREATE TABLE `couriers` (
	`id` varchar(32) NOT NULL,
	`userId` varchar(32) NOT NULL,
	`code` varchar(20) NOT NULL,
	`employmentType` enum('FREELANCE','SHIFT','FULL_TIME') NOT NULL DEFAULT 'FREELANCE',
	`status` enum('PENDING_ONBOARDING','ACTIVE','SUSPENDED','OFFBOARDED') NOT NULL DEFAULT 'PENDING_ONBOARDING',
	`availability` enum('OFFLINE','ONLINE','ON_BREAK','BUSY') NOT NULL DEFAULT 'OFFLINE',
	`nationalId` varchar(14),
	`dateOfBirth` date,
	`vehicleType` enum('MOTORCYCLE','SCOOTER','BICYCLE','CAR','VAN','ON_FOOT') NOT NULL DEFAULT 'MOTORCYCLE',
	`vehiclePlate` varchar(20),
	`licenseNumber` varchar(40),
	`licenseExpiry` date,
	`homeHubId` varchar(32),
	`perDeliveryRateCents` int NOT NULL DEFAULT 2000,
	`perPickupRateCents` int NOT NULL DEFAULT 500,
	`failedAttemptRateCents` int NOT NULL DEFAULT 500,
	`hourlyRateCents` int NOT NULL DEFAULT 0,
	`monthlySalaryCents` int NOT NULL DEFAULT 0,
	`cashLimitCents` int NOT NULL DEFAULT 500000,
	`cashOnHandCents` int NOT NULL DEFAULT 0,
	`maxActiveOrders` int NOT NULL DEFAULT 30,
	`rating` double NOT NULL DEFAULT 5,
	`ratingCount` int NOT NULL DEFAULT 0,
	`xp` int NOT NULL DEFAULT 0,
	`streakDays` int NOT NULL DEFAULT 0,
	`lastLat` double,
	`lastLng` double,
	`lastSeenAt` datetime(3),
	`walletPhone` varchar(20),
	`bankDetails` longtext,
	`emergencyContact` longtext,
	`joinedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `couriers_id` PRIMARY KEY(`id`),
	CONSTRAINT `couriers_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `couriers_code_unique` UNIQUE(`code`),
	CONSTRAINT `couriers_nationalId_unique` UNIQUE(`nationalId`)
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` varchar(32) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`name` varchar(150) NOT NULL,
	`email` varchar(191),
	`altPhone` varchar(20),
	`totalOrders` int NOT NULL DEFAULT 0,
	`deliveredOrders` int NOT NULL DEFAULT 0,
	`refusedOrders` int NOT NULL DEFAULT 0,
	`reliabilityScore` int NOT NULL DEFAULT 80,
	`isBlocked` boolean NOT NULL DEFAULT false,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `delivery_attempts` (
	`id` varchar(32) NOT NULL,
	`orderId` varchar(32) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`attemptNo` int NOT NULL,
	`success` boolean NOT NULL,
	`failureReason` enum('CUSTOMER_UNREACHABLE','CUSTOMER_REFUSED','CUSTOMER_RESCHEDULED','WRONG_ADDRESS','INCOMPLETE_ADDRESS','NO_CASH','CUSTOMER_NOT_PRESENT','OUT_OF_ZONE','PACKAGE_DAMAGED','SECURITY_ACCESS','OTHER'),
	`note` varchar(1000),
	`lat` double,
	`lng` double,
	`photoUrl` varchar(500),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `delivery_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` varchar(32) NOT NULL,
	`key` varchar(300) NOT NULL,
	`url` varchar(500) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`sizeBytes` int NOT NULL,
	`purpose` varchar(40) NOT NULL,
	`uploadedById` varchar(32),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `files_id` PRIMARY KEY(`id`),
	CONSTRAINT `files_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `governorates` (
	`id` varchar(32) NOT NULL,
	`code` varchar(10) NOT NULL,
	`nameEn` varchar(100) NOT NULL,
	`nameAr` varchar(100) NOT NULL,
	CONSTRAINT `governorates_id` PRIMARY KEY(`id`),
	CONSTRAINT `governorates_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `hubs` (
	`id` varchar(32) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(120) NOT NULL,
	`nameAr` varchar(120),
	`address` varchar(300) NOT NULL,
	`lat` double NOT NULL,
	`lng` double NOT NULL,
	`phone` varchar(20),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `hubs_id` PRIMARY KEY(`id`),
	CONSTRAINT `hubs_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` varchar(32) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`provider` enum('SHOPIFY','WOOCOMMERCE','ZID','SALLA','EASYORDERS','CUSTOM') NOT NULL,
	`shopDomain` varchar(191) NOT NULL DEFAULT '',
	`credentials` text,
	`settings` longtext,
	`inboundSecret` varchar(100) NOT NULL,
	`status` enum('ACTIVE','PAUSED','ERROR') NOT NULL DEFAULT 'ACTIVE',
	`lastSyncAt` datetime(3),
	`lastError` varchar(1000),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `integration_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `integ_uq` UNIQUE(`brandId`,`provider`,`shopDomain`)
);
--> statement-breakpoint
CREATE TABLE `job_locks` (
	`name` varchar(60) NOT NULL,
	`lockedUntil` datetime(3) NOT NULL,
	`lastRunAt` datetime(3),
	`lastResult` varchar(1000),
	CONSTRAINT `job_locks_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `ledger_accounts` (
	`id` varchar(32) NOT NULL,
	`code` varchar(80) NOT NULL,
	`name` varchar(150) NOT NULL,
	`type` enum('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE') NOT NULL,
	`brandId` varchar(32),
	`courierId` varchar(32),
	`balanceCents` int NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ledger_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `ledger_accounts_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` varchar(32) NOT NULL,
	`transactionId` varchar(32) NOT NULL,
	`accountId` varchar(32) NOT NULL,
	`debitCents` int NOT NULL DEFAULT 0,
	`creditCents` int NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ledger_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ledger_transactions` (
	`id` varchar(32) NOT NULL,
	`kind` enum('COD_COLLECTED','ORDER_FEES','FEE_REVERSAL','COURIER_EARNING','CASH_HANDOVER','CASH_VARIANCE','BRAND_PAYOUT','COURIER_PAYOUT','COURIER_ADJUSTMENT','MANUAL_ADJUSTMENT') NOT NULL,
	`reference` varchar(120) NOT NULL,
	`description` varchar(300) NOT NULL,
	`orderId` varchar(32),
	`createdById` varchar(32),
	`metadata` longtext,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ledger_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `ledger_transactions_reference_unique` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(32) NOT NULL,
	`channel` enum('SMS','WHATSAPP','EMAIL','PUSH','IN_APP') NOT NULL,
	`recipient` varchar(191) NOT NULL,
	`userId` varchar(32),
	`orderId` varchar(32),
	`template` varchar(60) NOT NULL,
	`locale` enum('en','ar') NOT NULL DEFAULT 'ar',
	`title` varchar(200),
	`body` text NOT NULL,
	`data` longtext,
	`status` enum('QUEUED','SENT','FAILED','READ') NOT NULL DEFAULT 'QUEUED',
	`provider` varchar(40),
	`providerMessageId` varchar(120),
	`error` varchar(1000),
	`attempts` int NOT NULL DEFAULT 0,
	`sentAt` datetime(3),
	`readAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` varchar(32) NOT NULL,
	`orderId` varchar(32) NOT NULL,
	`status` enum('CREATED','PICKUP_ASSIGNED','PICKED_UP','RECEIVED_AT_HUB','ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','FAILED_ATTEMPT','RESCHEDULED','ON_HOLD','RETURN_PENDING','RETURN_OUT','RETURNED','CANCELLED','LOST','DAMAGED') NOT NULL,
	`fromStatus` enum('CREATED','PICKUP_ASSIGNED','PICKED_UP','RECEIVED_AT_HUB','ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','FAILED_ATTEMPT','RESCHEDULED','ON_HOLD','RETURN_PENDING','RETURN_OUT','RETURNED','CANCELLED','LOST','DAMAGED'),
	`reason` varchar(60),
	`note` varchar(1000),
	`actorId` varchar(32),
	`actorType` enum('SYSTEM','STAFF','BRAND','COURIER','CUSTOMER','API','INTEGRATION') NOT NULL,
	`actorName` varchar(150),
	`hubId` varchar(32),
	`lat` double,
	`lng` double,
	`isPublic` boolean NOT NULL DEFAULT true,
	`metadata` longtext,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `order_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` varchar(32) NOT NULL,
	`trackingNumber` varchar(16) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`brandReference` varchar(100),
	`type` enum('DELIVERY','EXCHANGE','RETURN','CASH_COLLECTION') NOT NULL DEFAULT 'DELIVERY',
	`serviceLevel` enum('STANDARD','SAME_DAY','EXPRESS','SCHEDULED') NOT NULL DEFAULT 'STANDARD',
	`status` enum('CREATED','PICKUP_ASSIGNED','PICKED_UP','RECEIVED_AT_HUB','ASSIGNED','OUT_FOR_DELIVERY','DELIVERED','FAILED_ATTEMPT','RESCHEDULED','ON_HOLD','RETURN_PENDING','RETURN_OUT','RETURNED','CANCELLED','LOST','DAMAGED') NOT NULL DEFAULT 'CREATED',
	`source` enum('PORTAL','API','BULK_UPLOAD','SHOPIFY','WOOCOMMERCE','ADMIN') NOT NULL DEFAULT 'PORTAL',
	`customerId` varchar(32) NOT NULL,
	`recipientName` varchar(150) NOT NULL,
	`recipientPhone` varchar(20) NOT NULL,
	`recipientAltPhone` varchar(20),
	`addressLine` varchar(500) NOT NULL,
	`building` varchar(50),
	`floor` varchar(20),
	`apartment` varchar(20),
	`landmark` varchar(200),
	`zoneId` varchar(32) NOT NULL,
	`lat` double,
	`lng` double,
	`pickupLocationId` varchar(32),
	`hubId` varchar(32),
	`pickupId` varchar(32),
	`runsheetId` varchar(32),
	`routeSequence` int,
	`courierId` varchar(32),
	`packageDescription` varchar(500),
	`itemsCount` int NOT NULL DEFAULT 1,
	`weightGrams` int NOT NULL DEFAULT 1000,
	`isFragile` boolean NOT NULL DEFAULT false,
	`allowOpening` boolean NOT NULL DEFAULT false,
	`declaredValueCents` int NOT NULL DEFAULT 0,
	`paymentMethod` enum('COD','PREPAID') NOT NULL DEFAULT 'COD',
	`codAmountCents` int NOT NULL DEFAULT 0,
	`collectCents` int NOT NULL DEFAULT 0,
	`collectedCents` int NOT NULL DEFAULT 0,
	`feesPaidBy` enum('BRAND','RECIPIENT') NOT NULL DEFAULT 'BRAND',
	`shippingFeeCents` int NOT NULL DEFAULT 0,
	`codFeeCents` int NOT NULL DEFAULT 0,
	`extraFeesCents` int NOT NULL DEFAULT 0,
	`vatCents` int NOT NULL DEFAULT 0,
	`totalFeesCents` int NOT NULL DEFAULT 0,
	`attempts` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 3,
	`riskScore` int NOT NULL DEFAULT 0,
	`priority` int NOT NULL DEFAULT 0,
	`scheduledDate` date,
	`promisedBy` datetime(3),
	`pickedUpAt` datetime(3),
	`outForDeliveryAt` datetime(3),
	`deliveredAt` datetime(3),
	`returnedAt` datetime(3),
	`cancelledAt` datetime(3),
	`deliveryOtpRequired` boolean NOT NULL DEFAULT false,
	`podPhotoUrl` varchar(500),
	`podSignatureUrl` varchar(500),
	`podReceivedBy` varchar(150),
	`rating` int,
	`ratingComment` varchar(1000),
	`notes` varchar(1000),
	`internalNotes` varchar(2000),
	`tags` longtext,
	`settlementId` varchar(32),
	`cashHandoverId` varchar(32),
	`parentOrderId` varchar(32),
	`externalId` varchar(100),
	`metadata` longtext,
	`createdById` varchar(32),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_trackingNumber_unique` UNIQUE(`trackingNumber`),
	CONSTRAINT `orders_brand_ref_uq` UNIQUE(`brandId`,`brandReference`)
);
--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` varchar(32) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`purpose` enum('LOGIN','DELIVERY','TRACKING','PASSWORD_RESET') NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`orderId` varchar(32),
	`attempts` int NOT NULL DEFAULT 0,
	`expiresAt` datetime(3) NOT NULL,
	`consumedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `otp_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pickups` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`locationId` varchar(32) NOT NULL,
	`courierId` varchar(32),
	`status` enum('REQUESTED','ASSIGNED','IN_PROGRESS','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'REQUESTED',
	`scheduledDate` date NOT NULL,
	`timeWindow` varchar(20),
	`expectedCount` int NOT NULL DEFAULT 0,
	`pickedCount` int NOT NULL DEFAULT 0,
	`notes` varchar(1000),
	`failureNote` varchar(1000),
	`startedAt` datetime(3),
	`completedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pickups_id` PRIMARY KEY(`id`),
	CONSTRAINT `pickups_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `pricing_plans` (
	`id` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(500),
	`isDefault` boolean NOT NULL DEFAULT false,
	`codFeeBp` int NOT NULL DEFAULT 100,
	`codFeeMinCents` int NOT NULL DEFAULT 0,
	`includedWeightGrams` int NOT NULL DEFAULT 3000,
	`extraKgCents` int NOT NULL DEFAULT 500,
	`returnFeeBp` int NOT NULL DEFAULT 5000,
	`exchangeFeeCents` int NOT NULL DEFAULT 0,
	`insuranceBp` int NOT NULL DEFAULT 0,
	`vatBp` int NOT NULL DEFAULT 1400,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pricing_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pricing_rules` (
	`id` varchar(32) NOT NULL,
	`planId` varchar(32) NOT NULL,
	`tier` enum('A','B','C','D') NOT NULL,
	`serviceLevel` enum('STANDARD','SAME_DAY','EXPRESS','SCHEDULED') NOT NULL,
	`baseFeeCents` int NOT NULL,
	CONSTRAINT `pricing_rules_id` PRIMARY KEY(`id`),
	CONSTRAINT `pricing_rule_uq` UNIQUE(`planId`,`tier`,`serviceLevel`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` varchar(32) NOT NULL,
	`userId` varchar(32) NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`family` varchar(32) NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	`revokedAt` datetime(3),
	`userAgent` varchar(300),
	`ip` varchar(64),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `runsheets` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`hubId` varchar(32),
	`date` date NOT NULL,
	`status` enum('DRAFT','DISPATCHED','IN_PROGRESS','COMPLETED','CLOSED') NOT NULL DEFAULT 'DRAFT',
	`route` longtext,
	`totalDistanceKm` double,
	`totalMinutes` int,
	`expectedCodCents` int NOT NULL DEFAULT 0,
	`collectedCents` int NOT NULL DEFAULT 0,
	`dispatchedAt` datetime(3),
	`startedAt` datetime(3),
	`completedAt` datetime(3),
	`closedAt` datetime(3),
	`createdById` varchar(32),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `runsheets_id` PRIMARY KEY(`id`),
	CONSTRAINT `runsheets_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`key` varchar(80) NOT NULL,
	`value` int NOT NULL DEFAULT 0,
	CONSTRAINT `sequences_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`periodStart` datetime(3) NOT NULL,
	`periodEnd` datetime(3) NOT NULL,
	`ordersCount` int NOT NULL DEFAULT 0,
	`codCollectedCents` int NOT NULL DEFAULT 0,
	`feesCents` int NOT NULL DEFAULT 0,
	`vatCents` int NOT NULL DEFAULT 0,
	`adjustmentsCents` int NOT NULL DEFAULT 0,
	`netPayableCents` int NOT NULL DEFAULT 0,
	`status` enum('DRAFT','APPROVED','PAID','CANCELLED') NOT NULL DEFAULT 'DRAFT',
	`method` enum('BANK_TRANSFER','INSTAPAY','VODAFONE_CASH','CASH','FAWRY','OTHER'),
	`paymentReference` varchar(120),
	`invoiceNumber` varchar(40),
	`etaInvoiceUuid` varchar(100),
	`approvedById` varchar(32),
	`approvedAt` datetime(3),
	`paidAt` datetime(3),
	`notes` varchar(1000),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `settlements_code_unique` UNIQUE(`code`),
	CONSTRAINT `settlements_invoiceNumber_unique` UNIQUE(`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`startTime` varchar(5) NOT NULL,
	`endTime` varchar(5) NOT NULL,
	`daysOfWeek` longtext NOT NULL,
	`hubId` varchar(32),
	`zoneId` varchar(32),
	`requiredCouriers` int NOT NULL DEFAULT 1,
	`hourlyRateCents` int,
	`breakMinutes` int NOT NULL DEFAULT 30,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `shift_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` varchar(32) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`templateId` varchar(32),
	`hubId` varchar(32),
	`zoneId` varchar(32),
	`startAt` datetime(3) NOT NULL,
	`endAt` datetime(3) NOT NULL,
	`status` enum('SCHEDULED','CONFIRMED','IN_PROGRESS','COMPLETED','MISSED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
	`clockInAt` datetime(3),
	`clockOutAt` datetime(3),
	`clockInLat` double,
	`clockInLng` double,
	`clockOutLat` double,
	`clockOutLng` double,
	`workedMinutes` int NOT NULL DEFAULT 0,
	`breakMinutes` int NOT NULL DEFAULT 0,
	`lateMinutes` int NOT NULL DEFAULT 0,
	`overtimeMinutes` int NOT NULL DEFAULT 0,
	`hourlyRateCents` int NOT NULL DEFAULT 0,
	`payoutId` varchar(32),
	`notes` varchar(1000),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` varchar(80) NOT NULL,
	`value` longtext NOT NULL,
	`description` varchar(300),
	`updatedById` varchar(32),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `system_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `ticket_messages` (
	`id` varchar(32) NOT NULL,
	`ticketId` varchar(32) NOT NULL,
	`authorId` varchar(32),
	`authorType` enum('SYSTEM','STAFF','BRAND','COURIER','CUSTOMER','API','INTEGRATION') NOT NULL,
	`authorName` varchar(150) NOT NULL,
	`body` text NOT NULL,
	`isInternal` boolean NOT NULL DEFAULT false,
	`attachments` longtext,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ticket_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`subject` varchar(200) NOT NULL,
	`category` enum('DELAY','DAMAGED','LOST','COD_ISSUE','ADDRESS_CHANGE','RESCHEDULE','COMPLAINT','COURIER_BEHAVIOR','INQUIRY','OTHER') NOT NULL,
	`priority` enum('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
	`status` enum('OPEN','IN_PROGRESS','WAITING_ON_CUSTOMER','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
	`orderId` varchar(32),
	`brandId` varchar(32),
	`customerId` varchar(32),
	`openedById` varchar(32),
	`openedByType` enum('SYSTEM','STAFF','BRAND','COURIER','CUSTOMER','API','INTEGRATION') NOT NULL,
	`contactName` varchar(150),
	`contactPhone` varchar(20),
	`assigneeId` varchar(32),
	`slaDueAt` datetime(3),
	`resolvedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tickets_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(32) NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(191),
	`phone` varchar(20) NOT NULL,
	`passwordHash` varchar(100) NOT NULL,
	`role` enum('SUPER_ADMIN','OPS_MANAGER','DISPATCHER','HUB_OPERATOR','FINANCE','SUPPORT','BRAND_OWNER','BRAND_STAFF','COURIER') NOT NULL,
	`status` enum('ACTIVE','INVITED','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
	`locale` enum('en','ar') NOT NULL DEFAULT 'ar',
	`avatarUrl` varchar(500),
	`brandId` varchar(32),
	`hubId` varchar(32),
	`lastLoginAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` varchar(32) NOT NULL,
	`endpointId` varchar(32) NOT NULL,
	`event` varchar(60) NOT NULL,
	`payload` longtext NOT NULL,
	`status` enum('PENDING','SUCCESS','FAILED','DEAD') NOT NULL DEFAULT 'PENDING',
	`attempts` int NOT NULL DEFAULT 0,
	`nextAttemptAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`lastResponseCode` int,
	`lastResponseBody` text,
	`lastError` varchar(1000),
	`deliveredAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` varchar(32) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`url` varchar(500) NOT NULL,
	`secret` varchar(100) NOT NULL,
	`events` longtext NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`description` varchar(300),
	`failureCount` int NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `webhook_endpoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `zones` (
	`id` varchar(32) NOT NULL,
	`code` varchar(30) NOT NULL,
	`nameEn` varchar(100) NOT NULL,
	`nameAr` varchar(100) NOT NULL,
	`cityId` varchar(32) NOT NULL,
	`hubId` varchar(32),
	`tier` enum('A','B','C','D') NOT NULL DEFAULT 'A',
	`keywords` longtext NOT NULL,
	`polygon` longtext,
	`centerLat` double NOT NULL,
	`centerLng` double NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`slaHours` int NOT NULL DEFAULT 24,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `zones_id` PRIMARY KEY(`id`),
	CONSTRAINT `zones_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_users_id_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brand_locations` ADD CONSTRAINT `brand_locations_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brand_locations` ADD CONSTRAINT `brand_locations_zoneId_zones_id_fk` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brands` ADD CONSTRAINT `brands_pricingPlanId_pricing_plans_id_fk` FOREIGN KEY (`pricingPlanId`) REFERENCES `pricing_plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `brands` ADD CONSTRAINT `brands_accountManagerId_users_id_fk` FOREIGN KEY (`accountManagerId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_handovers` ADD CONSTRAINT `cash_handovers_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cash_handovers` ADD CONSTRAINT `cash_handovers_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cities` ADD CONSTRAINT `cities_governorateId_governorates_id_fk` FOREIGN KEY (`governorateId`) REFERENCES `governorates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_adjustments` ADD CONSTRAINT `courier_adjustments_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_adjustments` ADD CONSTRAINT `courier_adjustments_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_adjustments` ADD CONSTRAINT `courier_adjustments_payoutId_courier_payouts_id_fk` FOREIGN KEY (`payoutId`) REFERENCES `courier_payouts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_documents` ADD CONSTRAINT `courier_documents_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_locations` ADD CONSTRAINT `courier_locations_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_payouts` ADD CONSTRAINT `courier_payouts_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_zones` ADD CONSTRAINT `courier_zones_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `courier_zones` ADD CONSTRAINT `courier_zones_zoneId_zones_id_fk` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `couriers` ADD CONSTRAINT `couriers_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `couriers` ADD CONSTRAINT `couriers_homeHubId_hubs_id_fk` FOREIGN KEY (`homeHubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_attempts` ADD CONSTRAINT `delivery_attempts_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_attempts` ADD CONSTRAINT `delivery_attempts_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integration_connections` ADD CONSTRAINT `integration_connections_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_transactionId_ledger_transactions_id_fk` FOREIGN KEY (`transactionId`) REFERENCES `ledger_transactions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_accountId_ledger_accounts_id_fk` FOREIGN KEY (`accountId`) REFERENCES `ledger_accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ledger_transactions` ADD CONSTRAINT `ledger_transactions_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_customerId_customers_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_zoneId_zones_id_fk` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_pickupLocationId_brand_locations_id_fk` FOREIGN KEY (`pickupLocationId`) REFERENCES `brand_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_pickupId_pickups_id_fk` FOREIGN KEY (`pickupId`) REFERENCES `pickups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_runsheetId_runsheets_id_fk` FOREIGN KEY (`runsheetId`) REFERENCES `runsheets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_settlementId_settlements_id_fk` FOREIGN KEY (`settlementId`) REFERENCES `settlements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_cashHandoverId_cash_handovers_id_fk` FOREIGN KEY (`cashHandoverId`) REFERENCES `cash_handovers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_parentOrderId_orders_id_fk` FOREIGN KEY (`parentOrderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pickups` ADD CONSTRAINT `pickups_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pickups` ADD CONSTRAINT `pickups_locationId_brand_locations_id_fk` FOREIGN KEY (`locationId`) REFERENCES `brand_locations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pickups` ADD CONSTRAINT `pickups_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pricing_rules` ADD CONSTRAINT `pricing_rules_planId_pricing_plans_id_fk` FOREIGN KEY (`planId`) REFERENCES `pricing_plans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runsheets` ADD CONSTRAINT `runsheets_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runsheets` ADD CONSTRAINT `runsheets_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD CONSTRAINT `shift_templates_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD CONSTRAINT `shift_templates_zoneId_zones_id_fk` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_templateId_shift_templates_id_fk` FOREIGN KEY (`templateId`) REFERENCES `shift_templates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_zoneId_zones_id_fk` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_payoutId_courier_payouts_id_fk` FOREIGN KEY (`payoutId`) REFERENCES `courier_payouts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ticket_messages` ADD CONSTRAINT `ticket_messages_ticketId_tickets_id_fk` FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_customerId_customers_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_assigneeId_users_id_fk` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_endpointId_webhook_endpoints_id_fk` FOREIGN KEY (`endpointId`) REFERENCES `webhook_endpoints`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `webhook_endpoints_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `zones` ADD CONSTRAINT `zones_cityId_cities_id_fk` FOREIGN KEY (`cityId`) REFERENCES `cities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `zones` ADD CONSTRAINT `zones_hubId_hubs_id_fk` FOREIGN KEY (`hubId`) REFERENCES `hubs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `apikey_brand_idx` ON `api_keys` (`brandId`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_logs` (`actorId`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `bl_brand_idx` ON `brand_locations` (`brandId`);--> statement-breakpoint
CREATE INDEX `brands_status_idx` ON `brands` (`status`);--> statement-breakpoint
CREATE INDEX `ch_courier_status_idx` ON `cash_handovers` (`courierId`,`status`);--> statement-breakpoint
CREATE INDEX `cadj_courier_time_idx` ON `courier_adjustments` (`courierId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cdoc_courier_idx` ON `courier_documents` (`courierId`);--> statement-breakpoint
CREATE INDEX `cloc_courier_time_idx` ON `courier_locations` (`courierId`,`recordedAt`);--> statement-breakpoint
CREATE INDEX `cpay_courier_status_idx` ON `courier_payouts` (`courierId`,`status`);--> statement-breakpoint
CREATE INDEX `couriers_status_idx` ON `couriers` (`status`,`availability`);--> statement-breakpoint
CREATE INDEX `da_order_idx` ON `delivery_attempts` (`orderId`);--> statement-breakpoint
CREATE INDEX `da_courier_time_idx` ON `delivery_attempts` (`courierId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `la_brand_idx` ON `ledger_accounts` (`brandId`);--> statement-breakpoint
CREATE INDEX `la_courier_idx` ON `ledger_accounts` (`courierId`);--> statement-breakpoint
CREATE INDEX `le_account_idx` ON `ledger_entries` (`accountId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `le_tx_idx` ON `ledger_entries` (`transactionId`);--> statement-breakpoint
CREATE INDEX `lt_order_idx` ON `ledger_transactions` (`orderId`);--> statement-breakpoint
CREATE INDEX `lt_kind_time_idx` ON `ledger_transactions` (`kind`,`createdAt`);--> statement-breakpoint
CREATE INDEX `notif_user_status_idx` ON `notifications` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `notif_status_time_idx` ON `notifications` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `notif_order_idx` ON `notifications` (`orderId`);--> statement-breakpoint
CREATE INDEX `oe_order_time_idx` ON `order_events` (`orderId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_brand_created_idx` ON `orders` (`brandId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `orders_courier_status_idx` ON `orders` (`courierId`,`status`);--> statement-breakpoint
CREATE INDEX `orders_zone_status_idx` ON `orders` (`zoneId`,`status`);--> statement-breakpoint
CREATE INDEX `orders_phone_idx` ON `orders` (`recipientPhone`);--> statement-breakpoint
CREATE INDEX `orders_runsheet_idx` ON `orders` (`runsheetId`);--> statement-breakpoint
CREATE INDEX `orders_pickup_idx` ON `orders` (`pickupId`);--> statement-breakpoint
CREATE INDEX `orders_settlement_idx` ON `orders` (`settlementId`);--> statement-breakpoint
CREATE INDEX `orders_created_idx` ON `orders` (`createdAt`);--> statement-breakpoint
CREATE INDEX `otp_phone_idx` ON `otp_codes` (`phone`,`purpose`);--> statement-breakpoint
CREATE INDEX `otp_order_idx` ON `otp_codes` (`orderId`);--> statement-breakpoint
CREATE INDEX `pickups_status_date_idx` ON `pickups` (`status`,`scheduledDate`);--> statement-breakpoint
CREATE INDEX `pickups_courier_idx` ON `pickups` (`courierId`);--> statement-breakpoint
CREATE INDEX `rt_user_idx` ON `refresh_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `rt_family_idx` ON `refresh_tokens` (`family`);--> statement-breakpoint
CREATE INDEX `rs_courier_date_idx` ON `runsheets` (`courierId`,`date`);--> statement-breakpoint
CREATE INDEX `rs_status_idx` ON `runsheets` (`status`);--> statement-breakpoint
CREATE INDEX `settle_brand_status_idx` ON `settlements` (`brandId`,`status`);--> statement-breakpoint
CREATE INDEX `shifts_courier_start_idx` ON `shifts` (`courierId`,`startAt`);--> statement-breakpoint
CREATE INDEX `shifts_status_start_idx` ON `shifts` (`status`,`startAt`);--> statement-breakpoint
CREATE INDEX `tm_ticket_time_idx` ON `ticket_messages` (`ticketId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `tickets_status_prio_idx` ON `tickets` (`status`,`priority`);--> statement-breakpoint
CREATE INDEX `tickets_brand_idx` ON `tickets` (`brandId`);--> statement-breakpoint
CREATE INDEX `tickets_order_idx` ON `tickets` (`orderId`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_brand_idx` ON `users` (`brandId`);--> statement-breakpoint
CREATE INDEX `whd_status_next_idx` ON `webhook_deliveries` (`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `whd_endpoint_idx` ON `webhook_deliveries` (`endpointId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `wh_brand_idx` ON `webhook_endpoints` (`brandId`);--> statement-breakpoint
CREATE INDEX `zones_city_idx` ON `zones` (`cityId`);--> statement-breakpoint
CREATE INDEX `zones_hub_idx` ON `zones` (`hubId`);