import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import OnboardingFlow from './pages/auth/OnboardingFlow';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';

import MemberDashboard from './pages/member/MemberDashboard';
import MemberTasks from './pages/member/MemberTasks';
import TaskDetail from './pages/member/TaskDetail';
import MemberReports from './pages/member/MemberReports';
import PeerReviews from './pages/member/PeerReviews';
import TeamHub from './pages/member/TeamHub';

import SupervisorDashboard from './pages/supervisor/SupervisorDashboard';
import SupervisorTasks from './pages/supervisor/SupervisorTasks';
import ReviewQueue from './pages/supervisor/ReviewQueue';
import ReviewDetail from './pages/supervisor/ReviewDetail';
import Analytics from './pages/supervisor/Analytics';
import MyTeam from './pages/supervisor/MyTeam';
import PeerInsights from './pages/supervisor/PeerInsights';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminTeams from './pages/admin/AdminTeams';
import AdminSettings from './pages/admin/AdminSettings';
import AdminAudit from './pages/admin/AdminAudit';

export default function App() {
  const { user } = useAuth();

  // Password reset is a deep link — skip the splash/auth carousel.
  if (!user && window.location.pathname.startsWith('/reset-password')) {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/reset-password" replace />} />
      </Routes>
    );
  }

  const routesByRole: Record<string, React.ReactNode> = {
    member: (
      <>
        <Route path="/" element={<MemberDashboard />} />
        <Route path="/tasks" element={<MemberTasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/team" element={<TeamHub />} />
        <Route path="/reports" element={<MemberReports />} />
        <Route path="/peer-reviews" element={<PeerReviews />} />
      </>
    ),
    supervisor: (
      <>
        <Route path="/" element={<SupervisorDashboard />} />
        <Route path="/tasks" element={<SupervisorTasks />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/review/:id" element={<ReviewDetail />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/peer-reviews" element={<PeerInsights />} />
        <Route path="/team" element={<MyTeam />} />
      </>
    ),
    admin: (
      <>
        <Route path="/" element={<AdminDashboard />} />
        <Route path="/users" element={<AdminUsers />} />
        <Route path="/teams" element={<AdminTeams />} />
        <Route path="/settings" element={<AdminSettings />} />
        <Route path="/audit" element={<AdminAudit />} />
      </>
    ),
  };

  return (
    <OnboardingFlow>
      {user ? (
        <Layout>
          <Routes>
            {routesByRole[user.role]}
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      ) : (
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<div />} />
        </Routes>
      )}
    </OnboardingFlow>
  );
}
