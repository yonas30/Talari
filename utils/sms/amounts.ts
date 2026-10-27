// One rule for every bank (V2_SPEC Part Z, "Amount, charges and total"): the AMOUNT is the money that went to the other party, without charges;
// the FEE is every charge; the TOTAL debited is amount + fee. When a message prints a total, the three must agree to the cent. Pure.
export interface AmountFields {
  amount: number;
  fee: number | null;
  vat: number | null;
  otherCharge: number | null;
  totalDeducted: number | null;
  flags: string[];
}

const cents = (value: number | null): number => Math.round((value ?? 0) * 100);

// The flags this module sets. 'total_mismatch' is recomputed every time (a row stored with it is judged afresh); the two that say what was done
// are kept once set, so applying the rule again changes nothing.
export const AMOUNT_FLAGS = ['amount_was_total', 'fee_from_total', 'total_mismatch'] as const;

// Makes amount + fee equal to the printed total, or says plainly that it cannot:
//  - the figure read as the amount IS the total, and charges are listed: the amount is the total minus the charges (never the total, or
//    the charges would be saved on top of a total that already holds them);
//  - the charges are all zero but the total is larger than the amount: the fee is the difference;
//  - anything else that does not add up is NOT guessed: it is flagged 'total_mismatch'.
// A message with no printed total has nothing to check against and is returned as it is.
export function reconcileTotals<T extends AmountFields>(body: T): T {
  const flags = body.flags.filter((flag) => flag !== 'total_mismatch');
  const add = (flag: string) => {
    if (!flags.includes(flag)) flags.push(flag);
  };
  const result: T = { ...body, flags };
  if (body.totalDeducted === null) {
    return result;
  }
  const amount = cents(body.amount);
  const charges = cents(body.fee) + cents(body.vat) + cents(body.otherCharge);
  const total = cents(body.totalDeducted);
  if (amount + charges === total) {
    return result;
  }
  if (charges > 0 && amount === total) {
    result.amount = (total - charges) / 100;
    add('amount_was_total');
    return result;
  }
  if (charges === 0 && amount < total) {
    result.fee = (total - amount) / 100;
    add('fee_from_total');
    return result;
  }
  add('total_mismatch');
  return result;
}
