import { expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";

const FIXTURE = path.join(process.cwd(), "fixtures", "prescriptions", "rx-sunita-ghosh.png");

async function signIn(browser: Browser, phone: string, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("One-time code").fill("246810");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

test("customer reorders for a parent → pharmacist approves → store dispatches → customer opts into refill", async ({ browser }) => {
  // ── Customer (phone-sized viewport) ──
  const customer = await signIn(browser, "5550000001", { width: 390, height: 844 });
  await customer.getByRole("radio", { name: /Sunita Ghosh/ }).click();
  await expect(customer.getByRole("heading", { name: /Medicines for Sunita Ghosh/ })).toBeVisible();

  await customer.goto("/medicines?q=metformin");
  const card = customer.getByTestId("product-card").filter({ hasText: "Metformin 500 mg" }).filter({ hasText: "Strip of 15" }).first();
  await card.getByRole("button", { name: "Add to cart" }).click();
  await expect(customer.getByText("Added to cart")).toBeVisible();

  await customer.goto("/cart");
  await expect(customer.getByTestId("cart-line")).toHaveCount(1);
  for (const n of [2, 3, 4]) {
    await customer.getByRole("button", { name: "Increase Metformin 500 mg" }).click();
    await expect(customer.getByTestId("cart-line").locator("[aria-live=polite]")).toHaveText(String(n));
  }
  await customer.getByRole("link", { name: "Continue to checkout" }).click();
  await customer.waitForURL(/\/checkout/);

  await expect(customer.getByTestId("rx-file-input")).toBeEnabled();
  await customer.getByTestId("rx-file-input").setInputFiles(FIXTURE);
  await customer.waitForURL(/rx=/);
  await expect(customer.getByTestId("extraction-draft").getByText("Prescription read")).toBeVisible();
  await expect(customer.getByText("On the prescription (draft)")).toBeVisible();
  await expect(customer.getByText(/Nearest store with everything in stock: Salt Lake/)).toBeVisible();
  await customer.getByTestId("place-order").click();
  await customer.waitForURL(/\/orders\/.+placed=1/);
  await expect(customer.getByText("Order placed")).toBeVisible();
  const orderNumber = (await customer.getByRole("heading", { level: 1 }).innerText()).match(/RX-\d+/)![0];

  // ── Store cannot pick yet ──
  const store = await signIn(browser, "5550000201");
  await expect(store.getByText(orderNumber)).toBeVisible(); // listed under "waiting for the pharmacist"
  await expect(store.getByTestId("store-order").filter({ hasText: orderNumber })).toHaveCount(0);

  // ── Pharmacist ──
  const pharmacist = await signIn(browser, "5550000101");
  await pharmacist.getByTestId("queue-row").filter({ hasText: orderNumber }).getByRole("link", { name: "Review" }).click();
  await expect(pharmacist.getByTestId("rx-image").locator("img")).toBeVisible();
  await expect(pharmacist.getByLabel(/Prescriber \(doctor\)/)).toHaveValue("Dr. Arindam Banerjee");
  await expect(pharmacist.getByText("Draft line 1: Metformin 500 mg")).toBeVisible();
  // Nothing is approved until the pharmacist decides.
  await expect(pharmacist.getByTestId("submit-review")).toBeDisabled();
  await pharmacist.getByRole("radio", { name: "Approve" }).click();
  await expect(pharmacist.getByLabel("Units per day (for refills)")).toHaveValue("2");
  await pharmacist.getByTestId("submit-review").click();
  await pharmacist.waitForURL(/\/pharmacist$/);
  await expect(pharmacist.getByText("Decision recorded")).toBeVisible();

  // ── Store fulfils ──
  await store.reload();
  const order = store.getByTestId("store-order").filter({ hasText: orderNumber });
  await order.getByRole("button", { name: "Start picking" }).click();
  await order.getByLabel("Store invoice number").fill("SL-INV-E2E-0001");
  await order.getByRole("button", { name: "Mark packed" }).click();
  await order.getByLabel("Handed to").fill("Store rider (test)");
  await order.getByRole("button", { name: "Hand over to delivery" }).click();
  await order.getByRole("button", { name: "Mark delivered" }).click();
  await expect(store.getByTestId("store-order").filter({ hasText: orderNumber })).toHaveCount(0);

  // ── Customer sees delivery and opts into a refill reminder ──
  await customer.reload();
  await expect(customer.getByRole("heading", { level: 1 })).toContainText("Delivered");
  const plan = customer.getByTestId("order-refill-plan");
  await expect(plan).toContainText("60 units ÷ 2 a day ≈ 30 days");
  await plan.getByLabel("Remind me before this runs out").check();
  await expect(customer.getByText("Reminder turned on")).toBeVisible();
});

test("Schedule X items are blocked and staff pages are refused to customers", async ({ browser }) => {
  const customer = await signIn(browser, "5550000002");
  await customer.goto("/medicines?q=xelorex");
  const card = customer.getByTestId("product-card").first();
  await expect(card.getByText("This medicine cannot be ordered online")).toBeVisible();
  await expect(card.getByRole("button", { name: "Add to cart" })).toHaveCount(0);

  await customer.goto("/pharmacist");
  await expect(customer.getByText("You don’t have access to this page")).toBeVisible();
  const res = await customer.request.get("/api/prescriptions/not-a-real-id/file");
  expect(res.status()).toBe(404);
});

test("unreadable prescription asks for a re-upload before the order can be sent", async ({ browser }) => {
  const customer = await signIn(browser, "5550000003", { width: 390, height: 844 });
  await customer.goto("/medicines?q=levothyroxine");
  await customer.getByTestId("product-card").filter({ hasText: "Levothyroxine 50 mcg" }).filter({ hasText: "Generic" }).first().getByRole("button", { name: "Add to cart" }).click();
  await expect(customer.getByText("Added to cart")).toBeVisible();
  await customer.goto("/checkout");
  await expect(customer.getByTestId("rx-file-input")).toBeEnabled();
  await customer.getByTestId("rx-file-input").setInputFiles(path.join(process.cwd(), "fixtures", "prescriptions", "rx-arif-mondal-blurred.png"));
  await customer.waitForURL(/rx=/);
  await expect(customer.getByText("We couldn’t read this clearly")).toBeVisible();
  await expect(customer.getByTestId("place-order")).toBeDisabled();
  await customer.getByText("Send it anyway").click();
  await expect(customer.getByTestId("place-order")).toBeEnabled();
});

test("generic alternative needs the pharmacist's proposal and the customer's consent", async ({ browser }) => {
  const customer = await signIn(browser, "5550000001", { width: 390, height: 844 });
  await customer.getByRole("radio", { name: /Sunita Ghosh/ }).click();
  await expect(customer.getByRole("heading", { name: /Medicines for Sunita Ghosh/ })).toBeVisible();
  await customer.goto("/medicines?q=glucofine");
  await customer.getByTestId("product-card").filter({ hasText: "Glucofine 500" }).getByRole("button", { name: "Add to cart" }).click();
  await expect(customer.getByText("Added to cart")).toBeVisible();
  await customer.goto("/checkout");
  // Re-use the prescription already on file for this patient.
  await customer.locator('input[name="rx"]').first().click();
  await customer.waitForURL(/rx=/);
  await customer.getByTestId("place-order").click();
  await customer.waitForURL(/\/orders\/.+placed=1/);
  const orderNumber = (await customer.getByRole("heading", { level: 1 }).innerText()).match(/RX-\d+/)![0];

  const pharmacist = await signIn(browser, "5550000101");
  await pharmacist.getByTestId("queue-row").filter({ hasText: orderNumber }).getByRole("link", { name: "Review" }).click();
  await pharmacist.getByRole("radio", { name: "Generic alternative" }).click();
  const generic = pharmacist.getByLabel("Equivalent generic");
  await generic.selectOption({ index: 1 });
  await expect(generic.locator("option:checked")).toContainText("Metformin 500 mg (generic)");
  await pharmacist.getByTestId("submit-review").click();
  await pharmacist.waitForURL(/\/pharmacist$/);

  await customer.reload();
  await expect(customer.getByRole("heading", { level: 1 })).toContainText("Awaiting your consent");
  const consent = customer.getByTestId("consent-card");
  await expect(consent).toContainText("Glucofine 500");
  await expect(consent).toContainText("Metformin 500 mg");
  await consent.getByRole("button", { name: "Yes, I consent to the generic" }).click();
  await expect(customer.getByRole("heading", { level: 1 })).toContainText("Pharmacist approved");
  await expect(customer.getByText(/Generic alternative \(you consented\)/)).toBeVisible();
});
