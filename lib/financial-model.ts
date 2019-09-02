import { UserActionGroup, CreateOrUpdateAccount, UserAction, InjectMoney, UpdateDrain, DeleteDrain } from './user-actions';
import { Timestamp, AccountId, Money, MoneyRate } from './general';
import _ from 'lodash';
import * as i from 'immutable';
import { Record, RecordOf } from 'immutable';
import { unexpected, assertUnreachable, never } from './utils';

interface AccountStateFields {
  // Static (updated through actions)
  accountId: AccountId;
  capacity: Money;
  overflowTargetId?: AccountId;
  drainSizes: i.Map<AccountId, MoneyRate>;

  // Transient (updated through `updateTransients`)
  fillLevel: Money;
  fillRate: MoneyRate;
  overflowRate: MoneyRate;
  drainEffectiveRates: i.Map<AccountId, MoneyRate>;
  drainInflows: i.Map<AccountId, MoneyRate>;
  overflowInflows: i.Map<AccountId, MoneyRate>;
}

export type AccountState = RecordOf<AccountStateFields>;
export const AccountState = Record<AccountStateFields>({
  accountId: '',
  capacity: 0,
  fillLevel: 0,
  fillRate: 0,
  overflowTargetId: undefined,
  overflowRate: 0,
  drainSizes: i.Map<AccountId, MoneyRate>(),
  drainEffectiveRates: i.Map<AccountId, MoneyRate>(),
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

interface AccountNonlinearity {
  // Note: the modifier is used to avoid issues of numeric inaccuracy. That is,
  // we could calculate the next nonlinearity event, but due to calculation
  // error, we might calculate a state that is still within the linear region.
  // The modifier is a way to force the relevant part of the state to the exact
  // trigger of the nonlinearity. For example, if the nonlinearity is from an
  // account getting full, then modifier will _make_ the account full. The
  // modifier is applied after the linear projection, and is intended to clean
  // up any numeric errors in projection. The modifier is a function rather than
  // a state just for performance reasons, since the code that calculates the
  // modifier does it on all accounts with nonlinearities, even though most of
  // these are not used in each step.
  modifier: (account: AccountState) => AccountState;
  accountId: AccountId;
}

interface NonLinearities {
  timestamp: number; // Infinity if no more nonlinearities
  accounts: AccountNonlinearity[];
}

export type FinancialHistory = i.List<HistorySnapshot>;
export const FinancialHistory = () => i.List<HistorySnapshot>();

export const noAccounts: Accounts = i.Map<AccountId, AccountState>();

export const emptyAccount: AccountState = AccountState();

export function computeFinancialHistory(actions: UserActionGroup[]): FinancialHistory {
  // TODO: Check for malformed account graphs, with cycles or self-references
  // TODO: Check for negative flow rates
  // TODO: Validate for invalid transactions, such as taking too much out of account
  actions = _.sortBy(actions, 'timestamp');
  return i.List<HistorySnapshot>().withMutations(history => {
    let state: HistorySnapshot = HistorySnapshot({ timestamp: -Infinity, accounts: noAccounts });
    const dirtyAccounts = new Array<AccountId>();
    for (const actionGroup of actions) {
      // "Natural" non-linearity events that occur between user actions, such as accounts reaching capacity
      // TODO: Test cases for this
      for (const intermediate of computeIntermediateStates(state, actionGroup.timestamp)) {
        state = intermediate;
        history.push(state);
      }
      const timestamp = actionGroup.timestamp;
      state = projectLinear(state, timestamp);
      state = state.set('accounts', applyActions(state.accounts, actionGroup, dirtyAccounts));
      state = state.set('accounts', updateTransients(state.accounts, dirtyAccounts));
      history.push(HistorySnapshot(state));
    }

    for (const intermediate of computeIntermediateStates(state, Infinity)) {
      history.push(intermediate);
    }
  });
}

function* computeIntermediateStates(state: HistorySnapshot, targetTimestamp: number): IterableIterator<HistorySnapshot> {
  const dirtyAccounts = new Array<AccountId>();
  let nextNonlinearities = calculateNextNonlinearities(state);
  while (nextNonlinearities.timestamp < targetTimestamp) {
    state = projectLinear(state, nextNonlinearities.timestamp);
    for (const { accountId, modifier } of nextNonlinearities.accounts) {
      const accounts = state.accounts;
      state = state.set('accounts', accounts
        .set(accountId, modifier(accounts.get(accountId, never))));
      dirtyAccounts.push(accountId);
    }
    state = state.set('accounts', updateTransients(state.accounts, dirtyAccounts));
    yield state;
    nextNonlinearities = calculateNextNonlinearities(state);
  }
}

function projectLinear(state: HistorySnapshot, timestamp: number): HistorySnapshot {
  /*
  This function is optimized for just a few accounts being in a transient state.
  Likely, most accounts in a budget are either full or empty and not changing.

  Note: a linear projection will never make any accounts "dirty" in the sense
  that they need to be evaluated for transient changes (by updateTransients),
  because it is assumed to be used only to move along a linear segment of the
  account state.
  */

  const deltaTime = timestamp - state.timestamp;
  return HistorySnapshot({
    timestamp,
    accounts: state.accounts.withMutations(accounts => {
      // Making a copy because I'm not entirely sure if the immutable-js library
      // has taken into account the possibility of iterating over a collection
      // while mutating it, like the builtin collections do.
      const toIterate = [...accounts.keys()];
      for (const accountId of toIterate) {
        const account = accounts.get(accountId, never);
        if (account.fillRate !== 0) {
          accounts.set(accountId, account.set('fillLevel', account.fillLevel + account.fillRate * deltaTime))
        }
      }
    })
  });
}

function calculateNextNonlinearities(state: HistorySnapshot): NonLinearities {
  let earliestNonlinearities: NonLinearities = { timestamp: Infinity, accounts: [] };
  for (const [accountId, account] of state.accounts) {
    // Fill up
    // Note: an account can be at or above capacity with a positive fill level, if there is nowhere for it to overflow to
    if (account.fillRate > 0 && account.fillLevel < account.capacity) {
      const timestamp = state.timestamp + (account.capacity - account.fillLevel) / account.fillRate;
      nonlinearity(timestamp, {
        accountId,
        modifier: account => account.set('fillLevel', account.capacity)
      })
    }

    // Empty
    if (account.fillRate < 0 && account.fillLevel > 0) {
      const timestamp = state.timestamp + account.fillLevel / (-account.fillRate);
      nonlinearity(timestamp, {
        accountId,
        modifier: account => account.set('fillLevel', 0)
      });
    }
  }

  return earliestNonlinearities;

  function nonlinearity(timestamp: number, nonlinearity: AccountNonlinearity) {
    if (timestamp <= earliestNonlinearities.timestamp) {
      if (timestamp === earliestNonlinearities.timestamp) {
        earliestNonlinearities.accounts.push(nonlinearity);
      } else {
        earliestNonlinearities = { timestamp, accounts: [nonlinearity] };
      }
    }
  }
}

function applyActions(accounts: Accounts, actionGroup: UserActionGroup, dirtyAccounts: AccountId[]): Accounts {
  for (const action of actionGroup.actions) {
    accounts = dispatchAction(accounts, action, dirtyAccounts);
  }
  return accounts;
}

function dispatchAction(accounts: Accounts, action: UserAction, dirtyAccounts: AccountId[]): Accounts {
  switch (action.type) {
    case 'CreateOrUpdateAccount': return createOrUpdateAccount(accounts, action, dirtyAccounts);
    case 'InjectMoney': return injectMoney(accounts, action, dirtyAccounts);
    case 'UpdateDrain': return updateDrain(accounts, action, dirtyAccounts);
    case 'DeleteDrain': return deleteDrain(accounts, action, dirtyAccounts);
    case 'DeleteAccount': throw new Error('not implemented');
    default: return assertUnreachable(action);
  }
}

function deleteDrain(accounts: Accounts, action: DeleteDrain, dirtyAccounts: Array<AccountId>): Accounts {
  dirtyAccounts.push(action.sourceAccountId);
  return accounts.setIn([action.sourceAccountId, 'drainSizes', action.targetAccountId], 0);
}

function injectMoney(accounts: Accounts, action: InjectMoney, dirtyAccounts: Array<AccountId>): Accounts {
  const { accountId } = action;
  let account = accounts.get(accountId, emptyAccount);
  if (account.accountId !== action.accountId) {
    account = account.set('accountId', action.accountId);
  }
  account = account.set('fillLevel', account.fillLevel + action.amount);
  dirtyAccounts.push(accountId);
  return accounts.set(accountId, account);
}

function updateDrain(accounts: Accounts, action: UpdateDrain, dirtyAccounts: Array<AccountId>): Accounts {
  let sourceAccount = accounts.get(action.sourceAccountId, emptyAccount);
  if (sourceAccount.accountId !== action.sourceAccountId) {
    sourceAccount = sourceAccount.set('accountId', action.sourceAccountId);
  }

  sourceAccount = sourceAccount.setIn(['drainSizes', action.targetAccountId], action.maxRate);

  dirtyAccounts.push(action.sourceAccountId);
  return accounts.set(action.sourceAccountId, sourceAccount);
}

function createOrUpdateAccount(accounts: Accounts, action: CreateOrUpdateAccount, dirtyAccounts: Array<AccountId>): Accounts {
  const { accountId } = action;
  let account = accounts.get(accountId, emptyAccount);
  if (account.accountId !== action.accountId) {
    account = account.set('accountId', action.accountId);
  }
  if (action.capacity !== undefined) {
    account = account.set('capacity', action.capacity);
  }
  // TODO: I think this can be done as part of changing the overflow rate, if we assume that absent overflows are equivalent to zero rate
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

  return accounts.set(accountId, account);
}

function updateTransients(accounts: Accounts, dirtyAccounts: AccountId[]): Accounts {
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
    const totalPotentialDrainRate = account.drainSizes.reduce((a, x) => a + x, 0);
    // Run the drains at full capacity?
    if (account.fillLevel > 0 || effectiveInflowRate >= totalPotentialDrainRate) {
      effectiveDrainRate = totalPotentialDrainRate;
      const drainSizes = account.drainSizes;
      const drainEffectiveRates = account.drainEffectiveRates;
      for (const [targetAccountId, potentialRate] of drainSizes) {
        const effectiveRate = drainEffectiveRates.get(targetAccountId, 0);
        if (effectiveRate !== potentialRate) {
          account = account.setIn(['drainEffectiveRates', targetAccountId], potentialRate);
          accountChanged = true;
          accounts = accounts.setIn([targetAccountId, 'drainInflows', accountId], potentialRate);
          dirtyAccounts.push(targetAccountId);
        }
      }
    } else { // The drains are limited by inflow rate
      effectiveDrainRate = effectiveInflowRate;
      const drainSizes = account.drainSizes;
      const drainEffectiveRates = account.drainEffectiveRates;
      for (const [targetAccountId, potentialRate] of drainSizes) {
        const effectiveRate = drainEffectiveRates.get(targetAccountId, 0);
        // Inflow is divided proportionately between the drains
        const intendedRate = effectiveInflowRate * potentialRate / totalPotentialDrainRate;
        if (effectiveRate !== intendedRate) {
          account = account.setIn(['drainEffectiveRates', targetAccountId], intendedRate);
          accountChanged = true;
          accounts = accounts.setIn([targetAccountId, 'drainInflows', accountId], intendedRate);
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
      // Overflowing or stationary
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
