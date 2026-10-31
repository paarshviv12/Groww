export type Actor = "payer" | "merchant" | "chain" | "policy" | "gateway";
/** Names mirror the HSP payment state machine so the trace reads the same as the gateway's. */
export type HspState =
  | "payment-required" | "payment-submitted" | "payment-verified"
  | "payment-processing" | "payment-included" | "payment-safe" | "payment-finalized" | "payment-failed";

export interface TraceEvent {
  id: number;
  t: number; // ms since run start
  actor: Actor;
  title: string;
  detail?: string;
  status: "ok" | "warn" | "fail" | "info";
  hspState?: HspState;
  data?: Record<string, unknown>;
  links?: { label: string; href: string }[];
}

export class Tracer {
  readonly events: TraceEvent[] = [];
  private start = Date.now();
  constructor(private sink?: (e: TraceEvent) => void) {}
  emit(e: Omit<TraceEvent, "id" | "t">): TraceEvent {
    const ev: TraceEvent = { ...e, id: this.events.length + 1, t: Date.now() - this.start };
    this.events.push(ev);
    this.sink?.(ev);
    return ev;
  }
}
