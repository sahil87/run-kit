import type { OperatorRequestResult } from "@/api/client";

export const QUEUED_OPERATOR_TOAST = "Queued for operator — will be delivered when it is idle";

export function operatorRequestToast(result: OperatorRequestResult, delivered: string): string {
  return result.outcome === "queued" ? QUEUED_OPERATOR_TOAST : delivered;
}
