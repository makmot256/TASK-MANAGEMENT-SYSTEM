import { Router } from 'express';
import { pool } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT id, type, title, body, link, is_read, created_at FROM notifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const [unread] = await pool.execute(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`,
      [req.user.id]
    );
    res.json({ notifications: rows, unread: unread[0].c });
  })
);

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await pool.execute(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    res.json({ message: 'Marked read.' });
  })
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await pool.execute(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.user.id]);
    res.json({ message: 'All marked read.' });
  })
);

export default router;
