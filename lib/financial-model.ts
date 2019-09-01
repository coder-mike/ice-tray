import { UserActionGroup } from './user-actions';
import { Timestamp, AccountId, Money, MoneyRate } from './general';
import _ from 'lodash';
import * as i from 'immutable';
import { Record, RecordOf } from 'immutable';
import { assertUnreachable, unexpected } from './utils';

interface AccountStateFields {
  accountId: AccountId;
  capacity: Money;
  fillLevel: Money;
  fillRate: MoneyRate;
  overflowTargetId?: AccountId;
  overflowRate: MoneyRate;
  drains: i.Map<AccountId, DrainState>;
  drainInflows: i.Map<AccountId, MoneyRate>;
  overflowInflows: i.Map<AccountId, MoneyRate>;
}

export type DrainState = RecordOf<{
  potentialRate: MoneyRate,
  effectiveRate: MoneyRate,
}>;

export type AccountState = RecordOf<AccountStateFields>;
export const AccountState = Record<AccountStateFields>({
  accountId: '',
  capacity: 0,
  fillLevel: 0,
  fillRate: 0,
  overflowTargetId: undefined,
  overflowRate: 0,
  drains: i.Map<AccountId, DrainState>(),
  drainInflows: i.Map<AccountId, MoneyRate>(),
  overflowInflows: i.Map<AccountId, MoneyRate>(),
});

export type Accounts = i.Map<AccountId, AccountState>;

export interface HistorySnapshotFields {
  timestamp: Timestamp;
  accounts: i.Map<AccountId, AccountState>;
}

export type HistorySnapshot = RecordOf<HistorySnapshotFields>;
export const HistorySnapshot = Record<HistorySnapshotFields>({
  timestamp: 0,
  accounts: i.Map<AccountId, AccountState>()
});

export type FinancialHistory = i.List<HistorySnapshot>;

const noAccounts: Accounts = i.Map<AccountId, AccountState>();

const emptyAccount: AccountState = AccountState();

export function computeFinancialHistory(actions: UserActionGroup[]): FinancialHistory {
  // TODO: Check for malformed account graphs, with cycles or self-references
  // TODO: Check for negative flow rates
  // TODO: Validate for invalid transactions, such as taking too much out of account
  actions = _.sortBy(actions, 'timestamp');
  return i.List<HistorySnapshot>().withMutations(history => {
    let accounts = noAccounts;
    const dirtyAccounts = new Array<AccountId>();
    for (const actionGroup of actions) {
      const timestamp = actionGroup.timestamp;
      accounts = applyActions(accounts, actionGroup, dirtyAccounts);
      accounts = updateAccounts(accounts, dirtyAccounts);
      history.push(HistorySnapshot({ timestamp, accounts }));
    }
  });
}

function applyActions(accounts: Accounts, actionGroup: UserActionGroup, dirtyAccounts: AccountId[]): Accounts {
  for (const action of actionGroup.actions) {
    switch (action.type) {
      case 'CreateOrUpdateAccount': {
        const { accountId } = action;
        let account = accounts.get(accountId, emptyAccount);
        if (account.accountId !== action.accountId) {
          account = account.set('accountId', action.accountId);
        }
        if (action.capacity !== undefined) {
          account = account.set('capacity', action.capacity);
        }
        if (('overflowTargetId' in action) && action.overflowTargetId !== account.overflowTargetId) {
          const previousOverflowTargetId = account.overflowTargetId;
          // Disconnect the old overflow target
          if (previousOverflowTargetId !== undefined) {
            accounts = accounts.set(previousOverflowTargetId, accounts.get(previousOverflowTargetId, emptyAccount)
              .setIn(['overflowInflows', accountId], 0));
          }
          account = account.set('overflowTargetId', action.overflowTargetId);
        }
        dirtyAccounts.push(accountId);

        accounts = accounts.set(accountId, account);
        break;
      }
      case 'InjectMoney': {
        const { accountId } = action;
        let account = accounts.get(accountId, emptyAccount);
        if (account.accountId !== action.accountId) {
          account = account.set('accountId', action.accountId);
        }
        account = account.set('fillLevel', account.fillLevel + action.amount);
        dirtyAccounts.push(accountId);
        accounts = accounts.set(accountId, account);
        break;
      }
      // TODO: Don't forget that when we remove a drain, we need to remove flow to the drain target
      // TODO
      default: throw new Error('not implemented'); // return assertUnreachable(action);
    }
  }
  return accounts;
}

function updateAccounts(accounts: Accounts, dirtyAccounts: AccountId[]): Accounts {
  while (dirtyAccounts.length) {
    const accountId = dirtyAccounts.shift() || unexpected();
    let account = accounts.get(accountId, emptyAccount);
    let accountChanged = false;

    // Calculate once-off overflow
    const overflowTargetId = account.overflowTargetId;
    if (account.fillLevel >= account.capacity && overflowTargetId !== undefined) {
      const overflowAmount = account.fillLevel - account.capacity;
      account = account.set('fillLevel', account.capacity);
      accountChanged = true;
      let overflowAccount = accounts.get(overflowTargetId, emptyAccount);
      overflowAccount = overflowAccount.set('fillLevel', overflowAccount.fillLevel + overflowAmount);
      accounts = accounts.set(overflowTargetId, overflowAccount);
      dirtyAccounts.push(overflowTargetId);
    }

    const drainInflowRate = account.drainInflows.reduce((a, x) => a + x, 0);
    const overflowInflowRate = account.overflowInflows.reduce((a, x) => a + x, 0);
    const effectiveInflowRate = drainInflowRate + overflowInflowRate;
    let effectiveDrainRate: number;

    // Drains and fill rate
    const totalPotentialDrainRate = account.drains.reduce((a, x) => a + x.potentialRate, 0);
    // Run the drains at full capacity?
    if (account.fillLevel > 0 || effectiveInflowRate >= totalPotentialDrainRate) {
      effectiveDrainRate = totalPotentialDrainRate;
      for (const [targetAccountId, { effectiveRate, potentialRate }] of account.drains) {
        if (effectiveRate !== potentialRate) {
          account = account.setIn(['drains', targetAccountId, 'effectiveRate'], potentialRate);
          accountChanged = true;
          accounts = accounts.setIn([targetAccountId, 'drainInflows', accountId], effectiveRate);
          dirtyAccounts.push(targetAccountId);
        }
      }

    } else { // The drains are limited by inflow rate
      effectiveDrainRate = effectiveInflowRate;
      for (const [targetAccountId, { effectiveRate, potentialRate }] of account.drains) {
        // Inflow is divided proportionately between the drains
        const intendedRate = effectiveInflowRate * potentialRate / totalPotentialDrainRate;
        if (effectiveRate !== intendedRate) {
          account = account.setIn(['drains', targetAccountId, 'effectiveRate'], intendedRate);
          accountChanged = true;
          accounts = accounts.setIn([targetAccountId, 'drainInflows', accountId], effectiveRate);
          dirtyAccounts.push(targetAccountId);
        }
      }
    }

    const potentialFillRate = effectiveInflowRate - effectiveDrainRate;
    let fillRate: number;
    let overflowRate: number;
    if (potentialFillRate > 0 && (account.fillLevel < account.capacity || account.overflowTargetId === undefined)) {
      // Filling up
      fillRate = potentialFillRate;
      overflowRate = 0;
    } else if (potentialFillRate < 0) {
      // Filling down.
      // Note that this should never fill below empty because when empty, the
      // drains will stop draining and so the fill rate can't be negative when
      // empty (unless the inflow is negative)
      fillRate = potentialFillRate;
      overflowRate = 0;
    } else {
      // Overflowing
      fillRate = 0;
      overflowRate = potentialFillRate;
    }

    if (account.fillRate !== fillRate) {
      account = account.set('fillRate', fillRate);
      accountChanged = true;
    }

    if (account.overflowRate !== overflowRate) {
      account = account.set('overflowRate', overflowRate);
      accountChanged = true;
      if (overflowTargetId !== undefined) {
        accounts.set(overflowTargetId, accounts.get(overflowTargetId, emptyAccount)
          .setIn(['overflowInflows', accountId], overflowRate));
      }
    }

    if (accountChanged) {
      accounts = accounts.set(accountId, account);
    }
  }

  return accounts;
}
