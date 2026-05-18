-- Drop the businesses.type column.
--
-- The business-type concept (food / retail / services / wholesale /
-- manufacturing / other) shipped as a wizard step, an editable Manage
-- row, and a label on the hub list, but never gated any product
-- behavior — there were no type-specific defaults, no type-specific
-- routing, nothing actually keyed off the value. Removing the column
-- and every consumer (create wizard step, EditTypeModal, Manage row,
-- BusinessRow chip, BUSINESS_TYPES catalog, businessType API
-- envelope, related i18n keys) to eliminate the dead surface and the
-- user confusion it was producing.
--
-- This is a destructive column drop. Existing rows will lose any
-- value stored in `type` — but since nothing in product code ever
-- read the value to drive behavior, the loss is purely formal.

ALTER TABLE businesses DROP COLUMN type;
