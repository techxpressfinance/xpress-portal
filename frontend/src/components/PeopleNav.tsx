import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const ALL_TABS = [
  { label: 'Clients', to: '/admin/users', adminOnly: false },
  { label: 'Brokers', to: '/admin/brokers', adminOnly: true },
  { label: 'Referrers', to: '/admin/referrers', adminOnly: false },
];

export default function PeopleNav() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tabs = isAdmin ? ALL_TABS : ALL_TABS.filter(t => !t.adminOnly);

  return (
    <div className="flex gap-0 border-b border-border mb-6">
      {tabs.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `px-5 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
