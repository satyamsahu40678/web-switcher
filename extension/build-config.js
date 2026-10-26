// Fixture mode is never enabled in a distributed build.
export const ALLOW_TEST_ORIGINS = false;
// Provision an audited public trust anchor and exact HTTPS catalog URL at build
// time. No remote registry is trusted by default; manual mode works offline.
export const TRUSTED_REGISTRY_KEYS = {};
export const REGISTRY_URL = '';
