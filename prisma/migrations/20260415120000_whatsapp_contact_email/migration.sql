-- Lead: correo de contacto capturado desde el chat (seguimiento comercial / CRM)
ALTER TABLE `WhatsAppConversation` ADD COLUMN `contactEmail` VARCHAR(255) NULL;
