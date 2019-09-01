import { Timestamp, AccountId, Money } from "./general";

export interface UserActionGroup {
  timestamp: Timestamp;
  // A group of user actions is considered to be atomic, and so actions may
  // refer to each other. Examples:
  //  - an account and its overflow may be created atomically
  //  - atomically remove funds from one account and put them in another
  //  - the remaining balance on an account might be transferred atomically to deleting it
  actions: UserAction[];
}

export type UserAction =
  | CreateOrUpdateAccount
  | UpdateDrain
  | DeleteDrain
  | DeleteAccount
  | InjectMoney

export interface CreateOrUpdateAccount {
  type: 'CreateOrUpdateAccount';
  accountId: AccountId;
  capacity?: Money;
  overflowTargetId?: AccountId;
}

export interface DeleteAccount {
  type: 'DeleteAccount';
  accountId: AccountId;
}

export interface InjectMoney {
  type: 'InjectMoney';
  accountId: AccountId;
  amount: Money; // May be negative
}

export interface UpdateDrain {
  type: 'UpdateDrain';
  sourceAccountId: AccountId;
  targetAccountId: AccountId;
  maxRate: Money;
}

export interface DeleteDrain {
  type: 'DeleteDrain';
  sourceAccountId: AccountId;
  targetAccountId: AccountId;
}
