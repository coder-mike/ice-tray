import { AccountId, Money, MoneyRate, Timestamp } from "./general";

export interface AccountState {
  accountId: AccountId;
  fillLevel: Money;
  fillRate: MoneyRate;
  inflowRate: MoneyRate;
  drainRates: Array<{ targetId: AccountId, rate: MoneyRate }>;
  projectedToReachCapacity?: Timestamp;
  projectedToRunOut?: Timestamp;
}
