import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import RootLayout from './app/layout';
import EnvelopesLayout from './app/envelopes/EnvelopesLayout';
import EnvelopeListPage from './app/envelopes/page';
import EnvelopeViewPage from './app/envelopes/view/page';
import ChecklistsPage from './app/checklists/page';
import LibraryPage from './app/library/page';
import AuditPage from './app/audit/page';
import AccountLayout from './app/account/AccountLayout';
import { EnvelopeTitleProvider } from './context/EnvelopeTitleContext';
import { extraAppRoutes } from '@ee/app/routes';

export default function App() {
  return (
    <BrowserRouter>
      <EnvelopeTitleProvider>
      <RootLayout>
        <Routes>
          <Route path="/" element={<Navigate to="/envelopes" replace />} />
          {/* Envelopes routes share a layout with persistent sidebar */}
          <Route element={<EnvelopesLayout />}>
            <Route path="/envelopes" element={<EnvelopeListPage />} />
            <Route path="/envelopes/view" element={<EnvelopeViewPage />} />
            <Route path="/checklists" element={<ChecklistsPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/logs" element={<AuditPage />} />
          </Route>
          <Route path="/account" element={<Navigate to="/account/profile" replace />} />
          <Route path="/account/general" element={<Navigate to="/account/profile" replace />} />
          <Route path="/account/profile" element={<AccountLayout />} />
          <Route path="/account/security" element={<AccountLayout />} />
          <Route path="/account/members" element={<AccountLayout />} />
          <Route path="/account/ai" element={<AccountLayout />} />
          <Route path="/account/api" element={<AccountLayout />} />
          {extraAppRoutes}
        </Routes>
      </RootLayout>
      </EnvelopeTitleProvider>
    </BrowserRouter>
  );
}
