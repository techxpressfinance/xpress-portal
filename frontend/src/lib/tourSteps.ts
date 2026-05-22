import type { TourStep } from '../components/OnboardingTour';
import type { UserRole } from '../types';

export const TOUR_STORAGE_KEY = 'xpress-tour-completed-v1';

export const clientTourSteps: TourStep[] = [
  {
    title: 'Welcome to Xpress Tech',
    body: "Let's take a quick tour so you know where everything is. It only takes a minute — you can skip anytime.",
    route: '/dashboard',
  },
  {
    target: 'nav-dashboard',
    title: 'Your Dashboard',
    body: 'This is home base. See your total and active applications at a glance.',
    placement: 'right',
  },
  {
    target: 'new-application',
    title: 'Start a New Application',
    body: 'Apply for a loan from here. You can save your progress and come back later — no need to finish in one go.',
    placement: 'bottom',
  },
  {
    target: 'nav-applications',
    title: 'All Applications',
    body: 'View, continue, or track the status of every application you have submitted.',
    placement: 'right',
  },
  {
    target: 'nav-messages',
    title: 'Messages',
    body: 'Chat directly with your broker. They will reply here too.',
    placement: 'right',
  },
  {
    target: 'nav-service-requests',
    title: 'Service Requests',
    body: 'Need help with something outside a loan application? Submit a request here.',
    placement: 'right',
  },
  {
    target: 'nav-notifications',
    title: 'Notifications',
    body: 'Status changes, new messages, and alerts will appear here.',
    placement: 'right',
  },
  {
    target: 'nav-profile',
    title: 'Profile',
    body: 'Update your contact details, phone number, and password from here.',
    placement: 'right',
  },
  {
    title: "You're all set!",
    body: 'Tap "+ New Application" on your dashboard to get started. You can replay this tour any time from the sidebar.',
  },
];

export const referrerTourSteps: TourStep[] = [
  {
    title: 'Welcome to the Referrer Portal',
    body: "Here's a quick walkthrough of what you can do. Skip anytime.",
    route: '/referrer/applications',
  },
  {
    target: 'nav-applications',
    title: 'Referred Applications',
    body: 'Every application from a client you have referred shows up here with live status updates.',
    placement: 'right',
  },
  {
    target: 'add-lead',
    title: 'Add a New Lead',
    body: 'Refer a new client — enter their details and we will reach out and start the application.',
    placement: 'bottom',
  },
  {
    target: 'nav-clients',
    title: 'Your Clients',
    body: 'See everyone you have referred in one place, along with their application history.',
    placement: 'right',
  },
  {
    target: 'nav-messages',
    title: 'Messages',
    body: 'Stay in touch with brokers about your referrals.',
    placement: 'right',
  },
  {
    target: 'nav-service-requests',
    title: 'Service Requests',
    body: 'Submit a support request whenever you need help.',
    placement: 'right',
  },
  {
    target: 'nav-notifications',
    title: 'Notifications',
    body: 'Status changes on your referrals and new messages land here.',
    placement: 'right',
  },
  {
    target: 'nav-profile',
    title: 'Profile',
    body: 'Update your details and password here.',
    placement: 'right',
  },
  {
    title: "You're ready to go",
    body: 'Add your first lead any time, or replay this tour from the sidebar.',
  },
];

export function getTourSteps(role: UserRole | undefined): TourStep[] | null {
  if (role === 'client') return clientTourSteps;
  if (role === 'referrer') return referrerTourSteps;
  return null;
}

export function tourKey(userId: string): string {
  return `${TOUR_STORAGE_KEY}:${userId}`;
}

export function isTourCompleted(userId: string): boolean {
  try {
    return localStorage.getItem(tourKey(userId)) === 'true';
  } catch {
    return false;
  }
}

export function markTourCompleted(userId: string): void {
  try {
    localStorage.setItem(tourKey(userId), 'true');
  } catch {
    // ignore
  }
}

export function resetTour(userId: string): void {
  try {
    localStorage.removeItem(tourKey(userId));
  } catch {
    // ignore
  }
}
