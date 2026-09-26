import { createHmac, timingSafeEqual } from "node:crypto";

type RazorpayOrder = {
  id: string;
  amount: number;
  amount_paid: number;
  currency: string;
  status: string;
  receipt: string | null;
  notes: Record<string, string>;
};

type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
};

type RazorpayRefund = {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
};

export class RazorpayProviderError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Payment provider request failed");
    this.name = "RazorpayProviderError";
    this.code = code;
  }
}

function credentials() {
  const keyId = process.env["RAZORPAY_KEY_ID"]?.trim();
  const keySecret = process.env["RAZORPAY_KEY_SECRET"]?.trim();
  if (!keyId || !keySecret) throw new RazorpayProviderError("provider_not_configured");
  return { keyId, keySecret };
}

export function getRazorpayMode(): "test" | "live" {
  return credentials().keyId.startsWith("rzp_test_") ? "test" : "live";
}

async function razorpayRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { keyId, keySecret } = credentials();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    console.error("Razorpay request failed", { path, status: response.status });
    throw new RazorpayProviderError(`provider_http_${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function createRazorpayOrder(input: {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}) {
  return razorpayRequest<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
    }),
  });
}

export async function fetchRazorpayOrder(orderId: string) {
  return razorpayRequest<RazorpayOrder>(`/orders/${encodeURIComponent(orderId)}`);
}

export async function fetchRazorpayOrderPayments(orderId: string) {
  return razorpayRequest<{ items: RazorpayPayment[] }>(
    `/orders/${encodeURIComponent(orderId)}/payments`,
  );
}

export async function fetchRazorpayPayment(paymentId: string) {
  return razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
}

export async function refundRazorpayPayment(paymentId: string, amountPaise: number, requestId: string) {
  return razorpayRequest<RazorpayRefund>(`/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: JSON.stringify({ amount: amountPaise, notes: { request_id: requestId } }),
  });
}

export async function fetchRazorpayRefund(refundId: string) {
  return razorpayRequest<RazorpayRefund>(`/refunds/${encodeURIComponent(refundId)}`);
}

export function verifyRazorpayPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  const { keySecret } = credentials();
  const expected = createHmac("sha256", keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(input.signature, "utf8");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function verifyRazorpayWebhookSignature(body: string, signature: string) {
  const secret = process.env["RAZORPAY_WEBHOOK_SECRET"]?.trim();
  if (!secret) throw new RazorpayProviderError("webhook_not_configured");
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(signature, "utf8");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}