import { Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { PrecedentsPage } from './pages/PrecedentsPage';
import { RuleDetailPage } from './pages/RuleDetailPage';
import { RuleEditPage } from './pages/RuleEditPage';
import { RulesPage } from './pages/RulesPage';
import { ScanReviewPage } from './pages/ScanReviewPage';
import { ScansPage } from './pages/ScansPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ScansPage />} />
        <Route path="scans/:id" element={<ScanReviewPage />} />
        <Route path="precedents" element={<PrecedentsPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="rules/new" element={<RuleEditPage />} />
        <Route path="rules/:id" element={<RuleDetailPage />} />
        <Route path="rules/:id/edit" element={<RuleEditPage />} />
        <Route path="*" element={<p>Page not found.</p>} />
      </Route>
    </Routes>
  );
}
