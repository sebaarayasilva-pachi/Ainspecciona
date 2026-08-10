-- Nueva fuente ENTREGA: informes de entrega de obra nueva (mirada fabricación/terminaciones)
ALTER TABLE `knowledge_entry` MODIFY `source` ENUM('PROPERTYCHECK', 'AINSPECTA', 'POSTVENTA', 'ENTREGA') NOT NULL;
ALTER TABLE `ai_feedback` MODIFY `source` ENUM('PROPERTYCHECK', 'AINSPECTA', 'POSTVENTA', 'ENTREGA') NOT NULL DEFAULT 'PROPERTYCHECK';
ALTER TABLE `ai_report_correction` MODIFY `source` ENUM('PROPERTYCHECK', 'AINSPECTA', 'POSTVENTA', 'ENTREGA') NOT NULL DEFAULT 'AINSPECTA';
