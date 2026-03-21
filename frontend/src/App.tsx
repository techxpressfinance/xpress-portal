import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';

const ActivityLogs = lazy(() => import('./pages/admin/ActivityLogs'));
const AllApplications = lazy(() => import('./pages/admin/AllApplications'));
const KanbanBoard = lazy(() => import('./pages/admin/KanbanBoard'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const ReviewApplication = lazy(() => import('./pages/admin/ReviewApplication'));
const InviteClients = lazy(() => import('./pages/admin/InviteClients'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
import ApplicationDetail from './pages/client/ApplicationDetail';
import Applications from './pages/client/Applications';
import ClientDashboard from './pages/client/Dashboard';
import NewApplication from './pages/client/NewApplication';
import Profile from './pages/client/Profile';
import AdminMessages from './pages/admin/Messages';
import ClientMessages from './pages/client/Messages';
import Referrals from './pages/client/Referrals';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ResendVerification from './pages/ResendVerification';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'client' ? '/dashboard' : '/admin'} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
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
              <Route
                path="/admin/invite-clients"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <InviteClients />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/activity"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ActivityLogs />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
