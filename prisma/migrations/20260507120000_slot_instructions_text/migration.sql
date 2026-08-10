-- Slot.instructions: VARCHAR(191) is too short for buildPhotoPlanV1 / buildInstruction copy.
ALTER TABLE `Slot` MODIFY COLUMN `instructions` TEXT NOT NULL;
