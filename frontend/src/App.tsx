import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { useAuth } from './hooks/useAuth';

const ActivityLogs = lazy(() => import('./pages/admin/ActivityLogs'));
const AllApplications = lazy(() => import('./pages/admin/AllApplications'));
const KanbanBoard = lazy(() => import('./pages/admin/KanbanBoard'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const ReviewApplication = lazy(() => import('./pages/admin/ReviewApplication'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const BrokerManagement = lazy(() => import('./pages/admin/BrokerManagement'));
const ReferrerManagement = lazy(() => import('./pages/admin/ReferrerManagement'));
const LenderManagement = lazy(() => import('./pages/admin/LenderManagement'));
const LenderAnalytics = lazy(() => import('./pages/admin/LenderAnalytics'));
const Tasks = lazy(() => import('./pages/admin/Tasks'));
const TaskDetail = lazy(() => import('./pages/admin/TaskDetail'));
const Contacts = lazy(() => import('./pages/admin/Contacts'));
const ContactDetail = lazy(() => import('./pages/admin/ContactDetail'));
const QuoteSheets = lazy(() => import('./pages/admin/QuoteSheets'));
const BasCalculator = lazy(() => import('./pages/admin/BasCalculator'));
const ReferrerDashboard = lazy(() => import('./pages/referrer/Dashboard'));
const ReferrerApplications = lazy(() => import('./pages/referrer/Applications'));
const ReferrerApplicationDetail = lazy(() => import('./pages/referrer/ApplicationDetail'));
import ApplicationDetail from './pages/client/ApplicationDetail';
import Applications from './pages/client/Applications';
import ClientDashboard from './pages/client/Dashboard';
import NewApplication from './pages/client/NewApplication';
import Profile from './pages/client/Profile';
import AdminMessages from './pages/admin/Messages';
import ClientMessages from './pages/client/Messages';
import Referrals from './pages/client/Referrals';
import Login from './pages/Login';
import EnterCode from './pages/EnterCode';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ResendVerification from './pages/ResendVerification';
const PlatformLogin = lazy(() => import('./pages/PlatformLogin'));
const PlatformDashboard = lazy(() => import('./pages/platform/Dashboard'));
const TenantManagement = lazy(() => import('./pages/platform/TenantManagement'));
const CreateTenant = lazy(() => import('./pages/platform/CreateTenant'));
const TenantDetail = lazy(() => import('./pages/platform/TenantDetail'));

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'super_admin') return <Navigate to="/platform" replace />;
  if (user.role === 'referrer') return <Navigate to="/referrer" replace />;
  return <Navigate to={user.role === 'client' ? '/dashboard' : '/admin'} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <TenantProvider>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
          <Routes>
            <Route path="/platform-login" element={<PlatformLogin />} />
            <Route path="/login" element={<Login />} />
            <Route path="/enter-code" element={<EnterCode />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/resend-verification" element={<ResendVerification />} />
            <Route element={<Layout />}>
              <Route path="/" element={<HomeRedirect />} />

              {/* Client Routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={['client']}>
                    <ClientDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/applications"
                element={
                  <ProtectedRoute roles={['client']}>
                    <Applications />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/applications/new"
                element={
                  <ProtectedRoute roles={['client']}>
                    <NewApplication />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/applications/:id"
                element={
                  <ProtectedRoute roles={['client']}>
                    <ApplicationDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/messages"
                element={
                  <ProtectedRoute roles={['client']}>
                    <ClientMessages />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrals"
                element={
                  <ProtectedRoute roles={['client']}>
                    <Referrals />
                  </ProtectedRoute>
                }
              />

              {/* Shared Routes */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />

              {/* Admin/Broker Routes */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/applications"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <AllApplications />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/board"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <KanbanBoard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/applications/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ReviewApplication />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/messages"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <AdminMessages />
                  </ProtectedRoute>
                }
              />
              <Route path="/admin/invite-clients" element={<Navigate to="/admin/users" replace />} />
              <Route path="/admin/create-broker" element={<Navigate to="/admin/brokers" replace />} />
              <Route path="/admin/create-referrer" element={<Navigate to="/admin/referrers" replace />} />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/brokers"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <BrokerManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/referrers"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <ReferrerManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/lender-analytics"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <LenderAnalytics />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/lenders"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <LenderManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/tasks"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <Tasks />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/tasks/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <TaskDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/quotes"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <QuoteSheets />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/calculators"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <BasCalculator />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/contacts"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <Contacts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/contacts/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ContactDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/activity"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <ActivityLogs />
                  </ProtectedRoute>
                }
              />

              {/* Super Admin / Platform Routes */}
              <Route
                path="/platform"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <PlatformDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/platform/tenants"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <TenantManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/platform/tenants/new"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <CreateTenant />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/platform/tenants/:id"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <TenantDetail />
                  </ProtectedRoute>
                }
              />

              {/* Referrer Routes */}
              <Route
                path="/referrer"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/applications"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerApplications />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/applications/:id"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerApplicationDetail />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
      </TenantProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
