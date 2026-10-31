CREATE TABLE `brand_advances` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`type` enum('EARLY_PAYOUT','COD_ADVANCE') NOT NULL,
	`status` enum('REQUESTED','APPROVED','PAID','REJECTED','RECOVERED','CANCELLED') NOT NULL DEFAULT 'REQUESTED',
	`amountCents` int NOT NULL,
	`feeCents` int NOT NULL DEFAULT 0,
	`recoveredCents` int NOT NULL DEFAULT 0,
	`method` enum('BANK_TRANSFER','INSTAPAY','VODAFONE_CASH','CASH','FAWRY','OTHER'),
	`paymentReference` varchar(120),
	`notes` varchar(1000),
	`requestedById` varchar(32),
	`approvedById` varchar(32),
	`approvedAt` datetime(3),
	`paidAt` datetime(3),
	`recoveredAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `brand_advances_id` PRIMARY KEY(`id`),
	CONSTRAINT `brand_advances_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `call_logs` (
	`id` varchar(32) NOT NULL,
	`orderId` varchar(32) NOT NULL,
	`courierId` varchar(32) NOT NULL,
	`provider` varchar(30) NOT NULL,
	`providerCallId` varchar(120),
	`proxyNumber` varchar(20),
	`status` enum('INITIATED','RINGING','ANSWERED','NO_ANSWER','BUSY','FAILED','REPORTED') NOT NULL DEFAULT 'INITIATED',
	`durationSeconds` int NOT NULL DEFAULT 0,
	`startedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`endedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `call_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `carrier_partners` (
	`id` varchar(32) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(120) NOT NULL,
	`apiType` varchar(30) NOT NULL DEFAULT 'MANUAL',
	`credentials` text,
	`trackingUrlTemplate` varchar(300),
	`governorateCodes` longtext,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `carrier_partners_id` PRIMARY KEY(`id`),
	CONSTRAINT `carrier_partners_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` varchar(32) NOT NULL,
	`code` varchar(24) NOT NULL,
	`orderId` varchar(32) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`type` enum('LOST','DAMAGED','MISSING_ITEMS','WRONG_ITEM','DELAYED') NOT NULL,
	`status` enum('OPEN','UNDER_REVIEW','APPROVED','REJECTED','PAID') NOT NULL DEFAULT 'OPEN',
	`claimedCents` int NOT NULL,
	`approvedCents` int NOT NULL DEFAULT 0,
	`liabilityCapCents` int NOT NULL DEFAULT 0,
	`description` varchar(2000) NOT NULL,
	`evidence` longtext,
	`decisionNote` varchar(1000),
	`decidedById` varchar(32),
	`decidedAt` datetime(3),
	`paidAt` datetime(3),
	`courierId` varchar(32),
	`createdById` varchar(32),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `claims_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `customer_addresses` (
	`id` varchar(32) NOT NULL,
	`customerId` varchar(32) NOT NULL,
	`label` varchar(60),
	`addressLine` varchar(500) NOT NULL,
	`building` varchar(50),
	`floor` varchar(20),
	`apartment` varchar(20),
	`landmark` varchar(200),
	`zoneId` varchar(32) NOT NULL,
	`lat` double,
	`lng` double,
	`isVerified` boolean NOT NULL DEFAULT false,
	`source` enum('ORDER','CUSTOMER_PIN','WHATSAPP_LOCATION','GEOCODER','STAFF') NOT NULL DEFAULT 'ORDER',
	`usageCount` int NOT NULL DEFAULT 0,
	`deliveredCount` int NOT NULL DEFAULT 0,
	`lastUsedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `customer_addresses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inbound_messages` (
	`id` varchar(32) NOT NULL,
	`channel` enum('SMS','WHATSAPP','EMAIL','PUSH','IN_APP') NOT NULL,
	`fromPhone` varchar(20) NOT NULL,
	`body` text,
	`providerMessageId` varchar(120),
	`orderId` varchar(32),
	`intent` enum('CONFIRM','RESCHEDULE','CANCEL','ATTEMPT_TRUE','ATTEMPT_FALSE','LOCATION','OTHER') NOT NULL DEFAULT 'OTHER',
	`payload` longtext,
	`processedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `inbound_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `inbound_messages_providerMessageId_unique` UNIQUE(`providerMessageId`)
);
--> statement-breakpoint
CREATE TABLE `order_links` (
	`id` varchar(32) NOT NULL,
	`code` varchar(16) NOT NULL,
	`brandId` varchar(32) NOT NULL,
	`title` varchar(150) NOT NULL,
	`description` varchar(1000),
	`items` longtext NOT NULL,
	`codAmountCents` int NOT NULL DEFAULT 0,
	`paymentMethod` enum('COD','PREPAID') NOT NULL DEFAULT 'COD',
	`serviceLevel` enum('STANDARD','SAME_DAY','EXPRESS','SCHEDULED') NOT NULL DEFAULT 'STANDARD',
	`weightGrams` int NOT NULL DEFAULT 1000,
	`allowOpening` boolean NOT NULL DEFAULT false,
	`notes` varchar(500),
	`maxUses` int,
	`usesCount` int NOT NULL DEFAULT 0,
	`expiresAt` datetime(3),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdById` varchar(32),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `order_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `order_links_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` varchar(32) NOT NULL,
	`userId` varchar(32) NOT NULL,
	`endpoint` varchar(700) NOT NULL,
	`endpointHash` varchar(64) NOT NULL,
	`p256dh` varchar(200) NOT NULL,
	`auth` varchar(100) NOT NULL,
	`userAgent` varchar(300),
	`failures` int NOT NULL DEFAULT 0,
	`lastUsedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscriptions_endpointHash_unique` UNIQUE(`endpointHash`)
);
--> statement-breakpoint
ALTER TABLE `integration_connections` MODIFY COLUMN `provider` enum('SHOPIFY','WOOCOMMERCE','ZID','SALLA','EASYORDERS','YOUCAN','CUSTOM') NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_transactions` MODIFY COLUMN `kind` enum('COD_COLLECTED','ORDER_FEES','FEE_REVERSAL','COURIER_EARNING','CASH_HANDOVER','CASH_VARIANCE','BRAND_PAYOUT','COURIER_PAYOUT','COURIER_ADJUSTMENT','MANUAL_ADJUSTMENT','DIGITAL_COLLECTION','BRAND_ADVANCE','ADVANCE_RECOVERY','CLAIM_PAYOUT','FEE_ADJUSTMENT') NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `source` enum('PORTAL','API','BULK_UPLOAD','SHOPIFY','WOOCOMMERCE','ADMIN','ORDER_LINK','EASYORDERS','ZID','SALLA','YOUCAN') NOT NULL DEFAULT 'PORTAL';--> statement-breakpoint
ALTER TABLE `tickets` MODIFY COLUMN `category` enum('DELAY','DAMAGED','LOST','COD_ISSUE','ADDRESS_CHANGE','RESCHEDULE','COMPLAINT','COURIER_BEHAVIOR','INQUIRY','OTHER','ATTEMPT_DISPUTE','WEIGHT_DISPUTE') NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `blockedReason` varchar(300);--> statement-breakpoint
ALTER TABLE `customers` ADD `blockedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `customers` ADD `requirePrepayment` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_attempts` ADD `distanceMeters` int;--> statement-breakpoint
ALTER TABLE `delivery_attempts` ADD `callCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_attempts` ADD `disputeStatus` enum('NONE','CONFIRMED_BY_CUSTOMER','DISPUTED','UPHELD','REJECTED') DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE `delivery_attempts` ADD `disputedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `delivery_attempts` ADD `disputeNote` varchar(500);--> statement-breakpoint
ALTER TABLE `orders` ADD `confirmationStatus` enum('NOT_REQUIRED','PENDING','CONFIRMED','RESCHEDULED','DECLINED','NO_RESPONSE') DEFAULT 'NOT_REQUIRED' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `confirmationRequestedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `orders` ADD `confirmationRespondedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `orders` ADD `confirmationChannel` varchar(20);--> statement-breakpoint
ALTER TABLE `orders` ADD `holdReason` varchar(60);--> statement-breakpoint
ALTER TABLE `orders` ADD `collectionMethod` enum('CASH','INSTAPAY','WALLET','CARD','PAYMENT_LINK');--> statement-breakpoint
ALTER TABLE `orders` ADD `collectionStatus` enum('NOT_APPLICABLE','PENDING_CONFIRMATION','CONFIRMED','REJECTED') DEFAULT 'NOT_APPLICABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `collectionReference` varchar(120);--> statement-breakpoint
ALTER TABLE `orders` ADD `actualWeightGrams` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `dimensionsCm` longtext;--> statement-breakpoint
ALTER TABLE `orders` ADD `weightStatus` enum('NONE','ADJUSTED','DISPUTED','ACCEPTED','REVERSED') DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `weightAdjustmentCents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `customerAddressId` varchar(32);--> statement-breakpoint
ALTER TABLE `orders` ADD `orderLinkId` varchar(32);--> statement-breakpoint
ALTER TABLE `orders` ADD `partnerCarrierId` varchar(32);--> statement-breakpoint
ALTER TABLE `orders` ADD `partnerTrackingNumber` varchar(60);--> statement-breakpoint
ALTER TABLE `orders` ADD `handedToPartnerAt` datetime(3);--> statement-breakpoint
ALTER TABLE `brand_advances` ADD CONSTRAINT `brand_advances_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `call_logs` ADD CONSTRAINT `call_logs_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `call_logs` ADD CONSTRAINT `call_logs_courierId_couriers_id_fk` FOREIGN KEY (`courierId`) REFERENCES `couriers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `claims` ADD CONSTRAINT `claims_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `claims` ADD CONSTRAINT `claims_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_customerId_customers_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_zoneId_zones_id_fk` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inbound_messages` ADD CONSTRAINT `inbound_messages_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_links` ADD CONSTRAINT `order_links_brandId_brands_id_fk` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `adv_brand_status_idx` ON `brand_advances` (`brandId`,`status`);--> statement-breakpoint
CREATE INDEX `call_order_idx` ON `call_logs` (`orderId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `call_courier_idx` ON `call_logs` (`courierId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `claims_brand_status_idx` ON `claims` (`brandId`,`status`);--> statement-breakpoint
CREATE INDEX `claims_order_idx` ON `claims` (`orderId`);--> statement-breakpoint
CREATE INDEX `caddr_customer_idx` ON `customer_addresses` (`customerId`,`lastUsedAt`);--> statement-breakpoint
CREATE INDEX `inbound_phone_idx` ON `inbound_messages` (`fromPhone`,`createdAt`);--> statement-breakpoint
CREATE INDEX `inbound_order_idx` ON `inbound_messages` (`orderId`);--> statement-breakpoint
CREATE INDEX `olink_brand_idx` ON `order_links` (`brandId`);--> statement-breakpoint
CREATE INDEX `push_user_idx` ON `push_subscriptions` (`userId`);--> statement-breakpoint
CREATE INDEX `da_dispute_idx` ON `delivery_attempts` (`disputeStatus`);--> statement-breakpoint
CREATE INDEX `orders_confirmation_idx` ON `orders` (`confirmationStatus`,`status`);--> statement-breakpoint
CREATE INDEX `orders_collection_idx` ON `orders` (`collectionStatus`);