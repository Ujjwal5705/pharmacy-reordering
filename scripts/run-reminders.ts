/**
 * Sends refill reminders that are due, via the mock SMS/WhatsApp/in-app adapters (nothing is
 * actually sent). Reminders never create carts or orders. Run on a schedule in a real deployment.
 *
 *   npm run reminders:run
 */
import { dispatchDueReminders } from "../src/server/services/refills";
import { db } from "../src/server/db";

dispatchDueReminders()
  .then((r) => console.log(`Checked ${r.checked} due reminder(s); logged ${r.sent} mock notification(s).`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
