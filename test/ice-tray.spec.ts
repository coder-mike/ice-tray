import { computeFinancialHistory } from '../lib/financial-model';
import { assert } from 'chai';
import { UserActionGroup } from '../lib/user-actions';

describe('computeFinancialHistory', () => {
  it('No actions', () => {
    const history = computeFinancialHistory([]);
    assert(history.length === 0);
  });

  it('New account', () => {
    const actions: UserActionGroup[] = [];
    actions.push({
      timestampIssued: 10,
      timestampEffective: 11,
      description: '',
      actions: [{
        type: 'CreateOrUpdateAccount',
        accountId: 'a',
        capacity: 12,
        overflowTarget: undefined,
      }],
    })
    const history = computeFinancialHistory(actions);
    assert(history.length === 1);
  });
});
