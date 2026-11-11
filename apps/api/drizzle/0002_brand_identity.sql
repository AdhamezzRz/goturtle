-- Brand identity v1.2: move the untouched default tracking-page colour to the official
-- GoTurtle green (#00804C). Rows a person has saved (updatedById set) are left alone.
UPDATE `system_settings` SET `value` = '{"primaryColor":"#00804C"}', `updatedAt` = CURRENT_TIMESTAMP(3) WHERE `key` = 'branding' AND `updatedById` IS NULL AND UPPER(`value`) LIKE '%#1E8E5A%';
