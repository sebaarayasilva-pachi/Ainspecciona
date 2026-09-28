/** Versión vigente del Acuerdo de Confidencialidad (bump para re-pedir aceptación). */
export const PLATFORM_NDA_VERSION = 'AINSP-NDA-2026-1';

export function ndaStatusForSession(session) {
  const org = session?.organization;
  const user = session?.user;
  const required = !!(org && org.requiresNda && user && !user.isPlatformAdmin);
  const version = PLATFORM_NDA_VERSION;
  const acceptedAt = user?.ndaAcceptedAt || null;
  const userVersion = user?.ndaVersion || null;
  const accepted = !required || (!!acceptedAt && userVersion === version);
  return {
    required,
    accepted,
    version,
    acceptedAt: acceptedAt ? new Date(acceptedAt).toISOString() : null
  };
}
