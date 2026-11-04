// Transaction history, not inventory counts. A later sale never removes a
// confirmed purchase. Full refunds are cancelled only with source evidence.
export class PurchaseLedger {
  constructor(items) {
    this.catalog = new Map(items.map((i) => [i.id, i]));
    this.purchases = [];
    this.events = [];
    this.ordinal = 0;
    this.revision = 0;
  }
  record(event) {
    this.events.push(event);
  }
  flush(tick, actors, ended = false) {
    const events = this.events;
    this.events = [];
    const notifications = events.filter((e) => e.type === "notification");
    const changes = events.filter(
      (e) =>
        e.type === "change" &&
        !notifications.some(
          (n) =>
            n.user === e.user && n.itemId === e.itemId && n.sell === e.sell,
        ),
    );
    const transactions = [...notifications, ...changes].sort(
      (a, b) => a.order - b.order,
    );
    for (const e of transactions) {
      const item = this.catalog.get(e.itemId),
        actor = actors.get(e.user);
      if (!item || !actor) continue;
      const siblings = transactions.filter(
        (x) => x.user === e.user && x.sell === e.sell,
      );
      const receipts = events.filter(
        (x) =>
          x.type === "currency" &&
          x.user === e.user &&
          x.currencyType === 0 &&
          (e.sell ? x.delta > 0 : x.delta < 0),
      );
      const receipt =
        siblings.length === 1 && receipts.length === 1 ? receipts[0] : null;
      if (!e.sell) {
        this.revision++;
        this.purchases.push({
          id: `${tick}:${e.user}:${e.itemId}:${this.ordinal++}`,
          tick,
          playerId: actor.id,
          playerName: actor.name,
          itemId: e.itemId,
          status: "pending",
          paidCost: receipt ? -receipt.delta : null,
          catalogCost: item.cost,
          evidence: "Purchase event; awaiting refund resolution",
          sold: false,
        });
      } else {
        const buy = this.purchases.findLast(
          (p) =>
            p.playerId === actor.id &&
            p.itemId === e.itemId &&
            !p.sold &&
            p.status !== "refunded",
        );
        if (!buy) continue; // Items already held when recording began are not purchases.
        this.revision++;
        buy.sold = true;
        buy.soldTick = tick;
        if (
          actor.refundable?.includes(e.itemId) ||
          (receipt && buy.paidCost !== null && receipt.delta === buy.paidCost)
        ) {
          buy.status = "refunded";
          buy.evidence = actor.refundable?.includes(e.itemId)
            ? "Full-refund eligibility at return"
            : "Full purchase cost returned by currency event";
        } else if (
          receipt &&
          buy.paidCost !== null &&
          receipt.delta < buy.paidCost
        ) {
          buy.status = "confirmed";
          this.revision++;
          buy.evidence = "Partial sale receipt; original purchase retained";
        } else if (actor.refundable && !actor.refundable.includes(e.itemId)) {
          buy.status = "confirmed";
          this.revision++;
          buy.evidence = "Item was not eligible for full refund at sale";
        } else {
          buy.status = "review";
          buy.evidence = "Return observed; full refund versus sale unavailable";
        }
      }
    }
    for (const buy of this.purchases)
      if (buy.status === "pending") {
        const actor = [...actors.values()].find((a) => a.id === buy.playerId);
        if (
          actor?.refundable &&
          !actor.refundable.includes(buy.itemId) &&
          tick > buy.tick + 2
        ) {
          buy.status = "confirmed";
          this.revision++;
          buy.evidence = "Full-refund eligibility cleared without a return";
        } else if (ended && !buy.sold) {
          buy.status = "confirmed";
          this.revision++;
          buy.evidence = "Purchase retained through recorded game end";
        }
      }
  }
  snapshot(fromStart = false) {
    return {
      revision: this.revision,
      purchases: this.purchases,
      fromStart,
      coverage:
        "Recorded transaction events; spectator coverage requires acceptance testing",
      reviewCount: this.purchases.filter((p) => p.status === "review").length,
    };
  }
}
