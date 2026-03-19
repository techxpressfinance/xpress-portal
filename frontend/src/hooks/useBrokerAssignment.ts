import api from '../api/client';
import { useToast } from '../components/Toast';
import { getErrorMessage } from '../lib/utils';
import type { LoanApplication } from '../types';

export function useBrokerAssignment() {
  const { toast } = useToast();

  const assignBroker = async (appId: string, brokerId: string): Promise<LoanApplication | null> => {
    try {
      const { data } = await api.post(`/applications/${appId}/assign?broker_id=${brokerId}`);
      toast('Broker assigned', 'success');
      return data;
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to assign broker'), 'error');
      return null;
    }
  };

  const unassignBroker = async (appId: string, brokerId: string): Promise<LoanApplication | null> => {
    try {
      const { data } = await api.delete(`/applications/${appId}/assign?broker_id=${brokerId}`);
      toast('Broker removed', 'success');
      return data;
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to remove broker'), 'error');
      return null;
    }
  };

  return { assignBroker, unassignBroker };
}
