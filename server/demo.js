// Fixed, synthetic people for the "View as Provider"/"View as Scribe" buttons
// on the sign-in page (see LoginScreen.tsx) — a presenter clicks straight in
// without going through Google or ORCA. Local dev only: they bypass sign-in
// entirely, so a deployed instance must never offer or accept them (see
// routes/auth.js's POST /demo and session.js).
export function demoLoginEnabled() {
  return !process.env.VERCEL && process.env.NODE_ENV !== 'production';
}

const DEMO_PROVIDER = {
  id: '00000000-0000-4000-8000-00000000d001',
  name: 'Dr. Demo Provider',
  email: 'demo.provider@orcarehab.demo',
  roles: ['PROVIDER'],
};

const DEMO_SCRIBE = {
  id: '00000000-0000-4000-8000-00000000d002',
  name: 'Demo Scribe',
  email: 'demo.scribe@orcarehab.demo',
  roles: ['SCRIBE'],
};

export function demoPerson(role) {
  return role === 'scribe' ? DEMO_SCRIBE : DEMO_PROVIDER;
}

// The Demo Scribe works on the Demo Provider's team, so the two buttons are
// two viewpoints on one walk-through-able dataset.
export function demoTeamId() {
  return DEMO_PROVIDER.id;
}
