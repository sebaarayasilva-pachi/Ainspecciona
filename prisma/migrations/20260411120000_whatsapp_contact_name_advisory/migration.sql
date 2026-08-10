-- Persistir nombre y control de oferta de asesoría (evitar repetición y pérdida de contexto)
ALTER TABLE `WhatsAppConversation` ADD COLUMN `contactName` VARCHAR(120) NULL;
ALTER TABLE `WhatsAppConversation` ADD COLUMN `advisoryOffered` BOOLEAN NOT NULL DEFAULT false;
