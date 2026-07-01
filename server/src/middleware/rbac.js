// Role-Based Access Control (SRS 5.2 - enforced at the API level).
// Usage: router.get('/x', authenticate, requireRole('admin', 'supervisor'), handler)
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    next();
  };
}
