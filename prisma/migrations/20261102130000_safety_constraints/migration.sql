-- Database-level safety nets that hold even if application code is wrong.

-- Stock can never go negative and reservations can never exceed physical stock (no overselling).
ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_onHand_nonnegative" CHECK ("onHand" >= 0),
  ADD CONSTRAINT "InventoryItem_reserved_nonnegative" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "InventoryItem_reserved_within_onHand" CHECK ("reserved" <= "onHand");

ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_approvedQuantity_range"
  CHECK ("approvedQuantity" IS NULL OR ("approvedQuantity" > 0 AND "approvedQuantity" <= "quantity"));
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" > 0 AND "quantity" <= 20);
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_nonnegative" CHECK ("pricePaise" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitsPerPack_positive" CHECK ("unitsPerPack" > 0);

-- Statutory floor from the brief, enforced in the database as well as in code:
-- Schedule X and narcotic categories can never be configured as orderable online,
-- Schedule H/H1 always need a prescription and pharmacist approval, H1 always needs the register.
ALTER TABLE "MedicinePolicy" ADD CONSTRAINT "MedicinePolicy_statutory_floor" CHECK (
  ("category" NOT IN ('SCHEDULE_X', 'NARCOTIC') OR "onlineOrderable" = false)
  AND ("category" NOT IN ('SCHEDULE_H', 'SCHEDULE_H1') OR ("prescriptionRequired" = true AND "pharmacistApprovalRequired" = true))
  AND ("category" <> 'SCHEDULE_H1' OR "h1RegisterRequired" = true)
  AND ("prescriptionRequired" = false OR "pharmacistApprovalRequired" = true)
);
ALTER TABLE "MedicinePolicy" ADD CONSTRAINT "MedicinePolicy_effective_window"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- Append-only audit trail.
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

-- Human-friendly order numbers continuing after the brief's sample rows (RX-50211..RX-50219).
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 50231;
