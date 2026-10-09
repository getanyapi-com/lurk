/** Conservative reservation ledger for the throwaway X scouting experiment. */
export class ScoutBudget {
  spent = 0;
  reserved = 0;
  breached = false;
  constructor(readonly cap: number) {
    if (!Number.isFinite(cap) || cap < 0) throw Error("invalid budget");
  }
  reserve(amount: number) {
    if (this.breached) throw Error("provider exceeded reservation; further purchases disabled");
    if (!Number.isFinite(amount) || amount < 0) throw Error("invalid reservation");
    if (this.spent + this.reserved + amount > this.cap + 1e-12) throw Error("budget exhausted before request");
    this.reserved += amount;
    let settled = false;
    return (reported: unknown) => {
      if (settled) throw Error("reservation already settled");
      settled = true;
      const measured = typeof reported === "number" && Number.isFinite(reported) && reported >= 0;
      const cost = measured ? reported : amount;
      this.reserved -= amount;
      this.spent += cost;
      if (cost > amount + 1e-9) {
        this.breached = true;
        throw Error("provider exceeded reserved maximum; stop experiment");
      }
      return { cost, measured };
    };
  }
}
