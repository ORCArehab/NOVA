// How an ORCA person (see orcaClient.js) appears inside NOVA. Roles come only
// from ORCA — never from the browser, and never from anything stored in NOVA.

// ORCA roles -> NOVA's role, or null for no NOVA access. Someone holding both
// PROVIDER and SCRIBE uses NOVA as a provider; there's no role switching.
export function novaRole(roles) {
  if (roles.includes('PROVIDER')) return 'provider';
  if (roles.includes('SCRIBE')) return 'scribe';
  return null;
}

// NOVA_SCRIBE_TEAMS="scribe@orcarehab.com:<provider ORCA person id>,..." —
// which provider's patient list a scribe works in. Compatibility only: it
// picks the browser-local patient list a scribe sees and grants nothing
// (signing and API access depend only on ORCA roles). Central ORCA
// supervisions replace it.
function scribeTeams() {
  const teams = new Map();
  for (const entry of (process.env.NOVA_SCRIBE_TEAMS ?? '').split(',')) {
    const separator = entry.lastIndexOf(':');
    if (separator === -1) continue;
    const email = entry.slice(0, separator).trim().toLowerCase();
    const providerId = entry.slice(separator + 1).trim();
    if (email && providerId) teams.set(email, providerId);
  }
  return teams;
}

// A provider's team is their own; a scribe's is the provider they're mapped
// to, or their own when unmapped.
export function teamIdFor(person, role) {
  if (role !== 'scribe') return person.id;
  return scribeTeams().get(person.email.toLowerCase()) ?? person.id;
}

// What the browser gets to know about the signed-in user — no tokens, no
// ORCA roles beyond the NOVA role derived from them. null means no NOVA
// access. teamId overrides the team (demo sessions only, see demo.js).
export function clientUser(person, teamId) {
  const role = novaRole(person.roles);
  if (!role) return null;
  return { id: person.id, name: person.name, email: person.email, role, teamId: teamId ?? teamIdFor(person, role) };
}
