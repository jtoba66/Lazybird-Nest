import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { UploadProvider } from './contexts/UploadContext';
import { StorageProvider } from './contexts/StorageContext';
import { RefreshProvider } from './contexts/RefreshContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './layouts/DashboardLayout';

// Lazy load pages
const FoldersPage = lazy(() => import('./pages/FoldersPage').then(module => ({ default: module.FoldersPage })));
const NestPage = lazy(() => import('./pages/NestPage').then(module => ({ default: module.NestPage })));
const SharedLinksPage = lazy(() => import('./pages/SharedLinksPage').then(module => ({ default: module.SharedLinksPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then(module => ({ default: module.SignupPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then(module => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })));
const SharePage = lazy(() => import('./pages/SharePage').then(module => ({ default: module.SharePage })));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const RecoverySetupPage = lazy(() => import('./pages/RecoverySetupPage').then(module => ({ default: module.RecoverySetupPage })));
const TrashPage = lazy(() => import('./pages/TrashPage').then(module => ({ default: module.TrashPage })));
const TermsPage = lazy(() => import('./pages/TermsPage').then(module => ({ default: module.TermsPage })));
const PricingPage = lazy(() => import('./pages/PricingPage').then(module => ({ default: module.PricingPage })));
const LandingPage = lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));


// Lazy load Docs
const DocsLayout = lazy(() => import('./landing/components/DocsLayout').then(module => ({ default: module.DocsLayout })));
const DocsIndex = lazy(() => import('./landing/pages/docs/DocsIndex'));
const ArchitectureDoc = lazy(() => import('./landing/pages/docs/ArchitectureDoc'));
const APIDoc = lazy(() => import('./landing/pages/docs/APIDoc'));
const FrontendDoc = lazy(() => import('./landing/pages/docs/FrontendDoc'));
const DatabaseDoc = lazy(() => import('./landing/pages/docs/DatabaseDoc'));

import { ErrorBoundary } from './components/ErrorBoundary';

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const App = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <StorageProvider>
          <RefreshProvider>
            <UploadProvider>
              <ToastProvider>
                <BrowserRouter>
                  <ScrollToTop />
                  <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div></div>}>
                    <Routes>
                      {/* Public Routes */}
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/signup" element={<SignupPage />} />
                      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                      <Route path="/reset-password" element={<ResetPasswordPage />} />
                      <Route path="/s/:shareToken" element={<SharePage />} />
                      <Route path="/s/:shareToken" element={<SharePage />} />
                      <Route path="/terms" element={<TermsPage />} />
                      <Route path="/privacy" element={<TermsPage />} />

                      <Route
                        path="/recovery-setup"
                        element={
                          <ProtectedRoute>
                            <RecoverySetupPage />
                          </ProtectedRoute>
                        }
                      />

                      <Route path="/" element={<LandingPage />} />

                      {/* Documentation Routes */}
                      <Route path="/docs" element={<DocsLayout />}>
                        <Route index element={<DocsIndex />} />
                        <Route path="architecture" element={<ArchitectureDoc />} />
                        <Route path="api" element={<APIDoc />} />
                        <Route path="frontend" element={<FrontendDoc />} />
                        <Route path="database" element={<DatabaseDoc />} />
                      </Route>
                      <Route
                        path="/dashboard"
                        element={
                          <ProtectedRoute>
                            <DashboardLayout>
                              <NestPage />
                            </DashboardLayout>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/folders"
                        element={
                          <ProtectedRoute>
                            <DashboardLayout>
                              <FoldersPage />
                            </DashboardLayout>
                          </ProtectedRoute>
                        }
                      />

                      <Route
                        path="/shared"
                        element={
                          <ProtectedRoute>
                            <DashboardLayout>
                              <SharedLinksPage />
                            </DashboardLayout>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/trash"
                        element={
                          <ProtectedRoute>
                            <DashboardLayout>
                              <TrashPage />
                            </DashboardLayout>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/pricing"
                        element={
                          <ProtectedRoute>
                            <DashboardLayout>
                              <PricingPage />
                            </DashboardLayout>
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/settings"
                        element={
                          <ProtectedRoute>
                            <DashboardLayout>
                              <SettingsPage />
                            </DashboardLayout>
                          </ProtectedRoute>
                        }
                      />

                      <Route
                        path="/admin"
                        element={
                          <ProtectedRoute>
                            <AdminPage />
                          </ProtectedRoute>
                        }
                      />

                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </Suspense>
                </BrowserRouter>
              </ToastProvider>
            </UploadProvider>
          </RefreshProvider>
        </StorageProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
