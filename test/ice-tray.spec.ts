import { computeFinancialHistory, FinancialHistory, HistorySnapshot, AccountState, noAccounts } from '../lib/financial-model';
import { assert } from 'chai';
import { UserActionGroup } from '../lib/user-actions';
import { never } from '../lib/utils';
import * as i from 'immutable';

describe('computeFinancialHistory', () => {
  const actions: UserActionGroup[] = [];
  let accounts = noAccounts;
  let expected = FinancialHistory();

  it('No actions', () => {
    const history = computeFinancialHistory(actions);
    assert.equal(history.size, 0);
  });

  it('New account', () => {
    actions.push({
      timestamp: 10,
      actions: [{
        type: 'CreateOrUpdateAccount',
        accountId: 'a',
        capacity: 12,
        overflowTargetId: undefined,
      }],
    })
    const history = computeFinancialHistory(actions);
    accounts = accounts.set('a', AccountState({
      accountId: 'a',
      capacity: 12,
      fillLevel: 0,
      fillRate: 0
    }));
    expected = expected.push(HistorySnapshot({ timestamp: 10, accounts }));
    assert.deepEqual(history.toJS(), expected.toJS());
  });

  it('Inject money', () => {
    actions.push({
      timestamp: 15,
      actions: [{
        type: 'InjectMoney',
        accountId: 'a',
        amount: 6
      }],
    })
    const history = computeFinancialHistory(actions);
    accounts = accounts.set('a', accounts.get('a', never).set('fillLevel', 6));
    expected = expected.push(HistorySnapshot({ timestamp: 15, accounts }));
    assert.deepEqual(history.toJS(), expected.toJS());
  });

  it('Inject money past capacity, no overflow', () => {
    actions.push({
      timestamp: 20,
      actions: [{
        type: 'InjectMoney',
        accountId: 'a',
        amount: 9 // A further 9 will bring this account past capacity
      }],
    })
    const history = computeFinancialHistory(actions);
    accounts = accounts.set('a', accounts.get('a', never).set('fillLevel', 15));
    expected = expected.push(HistorySnapshot({ timestamp: 20, accounts }));
    assert.deepEqual(history.toJS(), expected.toJS());
  });

  it('Overflow on overflow addition', () => {
    actions.push({
      timestamp: 22,
      actions: [{
        type: 'CreateOrUpdateAccount',
        accountId: 'a',
        overflowTargetId: 'b'
      }, {
        type: 'CreateOrUpdateAccount',
        accountId: 'b'
      }],
    })
    const history = computeFinancialHistory(actions);
    accounts = accounts
      .set('a', accounts.get('a', never)
        .set('fillLevel', 12)
        .set('overflowTargetId', 'b'))
      .set('b', AccountState({ accountId: 'b', fillLevel: 3 }));
    expected = expected.push(HistorySnapshot({ timestamp: 22, accounts }));
    assert.deepEqual(history.toJS(), expected.toJS());
  });

  it('Overflow on injection', () => {
    actions.push({
      timestamp: 25,
      actions: [{
        type: 'InjectMoney',
        accountId: 'a',
        amount: 100
      }],
    })
    const history = computeFinancialHistory(actions);
    accounts = accounts.set('b', AccountState({ accountId: 'b', fillLevel: 103 }));
    expected = expected.push(HistorySnapshot({ timestamp: 25, accounts }));
    assert.deepEqual(history.toJS(), expected.toJS());
  });

  it('Drains', () => {
    // Drain 'a' into 'c'
    actions.push({
      timestamp: 30,
      actions: [{
        type: 'CreateOrUpdateAccount',
        accountId: 'c'
      }, {
        type: 'UpdateDrain',
        sourceAccountId: 'a',
        targetAccountId: 'c',
        maxRate: 3 // 3 currency units per time unit. Since capacity is 12, this should take 4 time units to drain
      }],
    })

    // Start of drain
    accounts = accounts
      .set('a', accounts.get('a', never)
        .set('fillRate', -3)
        .setIn(['drainEffectiveRates', 'c'], 3)
        .setIn(['drainSizes', 'c'], 3))
      .set('c', AccountState({
        accountId: 'c',
        fillLevel: 0,
        fillRate: 3,
        drainInflows: i.Map({ 'a': 3 })
      }));
    expected = expected.push(HistorySnapshot({ timestamp: 30, accounts }));

    // End of drain after 4 time units
    // accounts = accounts
    //   .setIn(['a', 'drainEffectiveRates', 'c'], 0)
    //   .setIn(['c', 'fillLevel'], 12)
    //   .setIn(['c', 'drainInflows', 'c'], 0)
    // expected = expected.push(HistorySnapshot({ timestamp: 34, accounts }));

    const history = computeFinancialHistory(actions);
    assert.deepEqual(history.toJS(), expected.toJS());
  });
});
