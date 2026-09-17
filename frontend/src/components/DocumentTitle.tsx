import { useEffect } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useTenant } from '../contexts/TenantContext';

// Longest / most specific patterns first: matchPath returns the first hit.
const TITLES: Array<[string, string]> = [
  ['/login', 'Sign in'],
  ['/platform-login', 'Platform sign in'],
  ['/register', 'Create account'],
  ['/verify-email', 'Verify email'],
  ['/resend-verification', 'Resend verification'],
  ['/forgot-password', 'Forgot password'],
  ['/reset-password', 'Reset password'],
  ['/setup-account', 'Set up your account'],
  ['/apply/:token', 'Complete your application'],
  ['/dashboard', 'Dashboard'],
  ['/applications/new', 'New application'],
  ['/applications/:id', 'Application'],
  ['/applications', 'My applications'],
  ['/messages', 'Messages'],
  ['/service-requests', 'Service requests'],
  ['/profile', 'Profile'],
  ['/admin/applications/new', 'New application'],
  ['/admin/applications/:id', 'Review application'],
  ['/admin/applications', 'Applications'],
  ['/admin/board', 'Pipeline board'],
  ['/admin/messages', 'Messages'],
  ['/admin/invite-clients', 'Invite clients'],
  ['/admin/create-broker', 'Create broker'],
  ['/admin/create-referrer', 'Create referrer'],
  ['/admin/users', 'Users'],
  ['/admin/brokers', 'Brokers'],
  ['/admin/referrers', 'Referrers'],
  ['/admin/admins', 'Admins'],
  ['/admin/broker-groups', 'Broker groups'],
  ['/admin/analytics/arrears', 'Arrears analytics'],
  ['/admin/analytics', 'Analytics'],
  ['/admin/lender-analytics', 'Lender analytics'],
  ['/admin/broker-analytics', 'Broker analytics'],
  ['/admin/settled-deals', 'Settled deals'],
  ['/admin/arrears', 'Arrears book'],
  ['/admin/lenders/:id', 'Lender'],
  ['/admin/lenders', 'Lenders'],
  ['/admin/tasks/:id', 'Task'],
  ['/admin/tasks', 'Tasks'],
  ['/admin/quotes', 'Quote sheets'],
  ['/admin/calculators', 'BAS calculator'],
  ['/admin/contacts/:id', 'Contact'],
  ['/admin/contacts', 'Contacts'],
  ['/admin/companies/:id', 'Company'],
  ['/admin/companies', 'Companies'],
  ['/admin/service-requests/:id', 'Service request'],
  ['/admin/service-requests', 'Service requests'],
  ['/admin/activity', 'Activity log'],
  ['/admin/deleted-applications', 'Deleted applications'],
  ['/admin', 'Dashboard'],
  ['/platform/tenants/new', 'New tenant'],
  ['/platform/tenants/:id', 'Tenant'],
  ['/platform/tenants', 'Tenants'],
  ['/platform', 'Platform'],
  ['/referrer/applications/:id', 'Application'],
  ['/referrer/applications', 'Applications'],
  ['/referrer/clients', 'Clients'],
  ['/referrer/messages', 'Messages'],
  ['/referrer/add-lead', 'Add lead'],
  ['/referrer/service-requests', 'Service requests'],
  ['/referrer/business-details', 'Business details'],
  ['/referrer', 'Dashboard'],
];

/** Sets document.title per route: "<page> · <tenant>" instead of one static title. */
export default function DocumentTitle() {
  const { pathname } = useLocation();
  const { tenant } = useTenant();

  useEffect(() => {
    const brand = tenant?.name || 'Xpress Finance';
    const hit = TITLES.find(([pattern]) => matchPath({ path: pattern, end: true }, pathname));
    document.title = hit ? `${hit[1]} · ${brand}` : brand;
  }, [pathname, tenant?.name]);

  return null;
}
