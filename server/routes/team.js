import { Router } from 'express';
import { listUsers } from '../userStore.js';

const router = Router();

// GET / -> the full roster, used by the Team page and by first-visit
// onboarding's "which provider are you scribing for" dropdown. Read-only:
// accounts are created on first Google sign-in (routes/auth.js), and team
// membership is otherwise managed in the accounts database, not in NOVA.
router.get('/', async (req, res) => {
  res.json(await listUsers());
});

export default router;
