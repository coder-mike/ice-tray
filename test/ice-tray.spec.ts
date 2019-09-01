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
});
