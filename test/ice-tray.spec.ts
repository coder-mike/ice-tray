import { computeFinancialHistory } from '../lib/financial-model';
import { assert } from 'chai';
import { UserActionGroup } from '../lib/user-actions';
import * as immutable from 'immutable';

describe('computeFinancialHistory', () => {
  const actions: UserActionGroup[] = [];
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
    assert.deepEqual(history.toJS(), [{
      timestamp: 10,
      accounts: {
        'a': {
          accountId: 'a',
          capacity: 12,
          fillLevel: 0,
          fillRate: 0,
          overflowTargetId: undefined,
          overflowRate: 0,
          drains: {},
          drainInflows: {},
          overflowInflows: {}
        }
      }
    }]);
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
    assert.deepEqual(history.toJS(), [{
      timestamp: 10,
      accounts: {
        'a': {
          accountId: 'a',
          capacity: 12,
          fillLevel: 0,
          fillRate: 0,
          overflowTargetId: undefined,
          overflowRate: 0,
          drains: {},
          drainInflows: {},
          overflowInflows: {}
        }
      }
    }, {
      timestamp: 15,
      accounts: {
        'a': {
          accountId: 'a',
          capacity: 12,
          fillLevel: 6,
          fillRate: 0,
          overflowTargetId: undefined,
          overflowRate: 0,
          drains: {},
          drainInflows: {},
          overflowInflows: {}
        }
      }
    }]);
  });
});
