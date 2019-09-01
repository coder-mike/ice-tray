import { computeFinancialHistory, FinancialHistory, HistorySnapshot, Accounts, AccountState, noAccounts } from '../lib/financial-model';
import { assert } from 'chai';
import { UserActionGroup } from '../lib/user-actions';
import { never } from '../lib/utils';

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

  it('Add overflow', () => {
    actions.push({
      timestamp: 20,
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
    expected = expected.push(HistorySnapshot({ timestamp: 20, accounts }));
    assert.deepEqual(history.toJS(), expected.toJS());
  });
});
