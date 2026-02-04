import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { UploadProvider } from './contexts/UploadContext';
import { StorageProvider } from './contexts/StorageContext';
import { RefreshProvider } from './contexts/RefreshContext';
import { ToastProvider } from './contexts/ToastContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './layouts/DashboardLayout';
import { FoldersPage } from './pages/FoldersPage';
import { NestPage } from './pages/NestPage';
import { SharedLinksPage } from './pages/SharedLinksPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SharePage } from './pages/SharePage';
import AdminPage from './pages/AdminPage';
import { RecoverySetupPage } from './pages/RecoverySetupPage';
import { TrashPage } from './pages/TrashPage';
import { TermsPage } from './pages/TermsPage';
import { PricingPage } from './pages/PricingPage';
import { LandingPage } from './pages/LandingPage';
import { DocsLayout } from './landing/components/DocsLayout';
import DocsIndex from './landing/pages/docs/DocsIndex';
import ArchitectureDoc from './landing/pages/docs/ArchitectureDoc';
import APIDoc from './landing/pages/docs/APIDoc';
import FrontendDoc from './landing/pages/docs/FrontendDoc';
import DatabaseDoc from './landing/pages/docs/DatabaseDoc';

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
