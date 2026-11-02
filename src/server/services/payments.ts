import { randomBytes } from "node:crypto";
import type { PaymentMethod } from "@prisma/client";
import type { Tx } from "../db";

/**
 * Test-mode payments only. No gateway is called and no payment instrument is collected;
 * UPI is simulated as instantly successful and COD as payable on delivery.
 */
export async function createTestPayment(tx: Tx, orderId: string, method: PaymentMethod, amountPaise: number) {
  const ref = `${method === "UPI_TEST" ? "TESTUPI" : "TESTCOD"}-${randomBytes(4).toString("hex").toUpperCase()}`;
  return tx.paymentRecord.create({
    data: { orderId, method, amountPaise, testReference: ref, status: method === "UPI_TEST" ? "TEST_PAID" : "COD_PENDING" },
  });
}

export async function adjustTestPayment(tx: Tx, orderId: string, amountPaise: number) {
  await tx.paymentRecord.updateMany({
    where: { orderId, status: { in: ["TEST_PAID", "COD_PENDING"] } },
    data: { amountPaise },
  });
}

export async function voidTestPayment(tx: Tx, orderId: string) {
  await tx.paymentRecord.updateMany({ where: { orderId, status: "TEST_PAID" }, data: { status: "TEST_REFUNDED" } });
  await tx.paymentRecord.updateMany({ where: { orderId, status: "COD_PENDING" }, data: { status: "VOID" } });
}

export async function collectCodOnDelivery(tx: Tx, orderId: string) {
  await tx.paymentRecord.updateMany({ where: { orderId, status: "COD_PENDING" }, data: { status: "COD_COLLECTED" } });
}
