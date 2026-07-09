import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';

import Login from './pages/Login';
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

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>{children}</div>;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <FullScreen><Spinner /></FullScreen>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
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
    <Layout>
      <Routes>
        {routesByRole[user.role]}
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
