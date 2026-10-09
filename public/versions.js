/* Software-release profiles. The bundled swagger.json is the 5.3 API, a superset of 5.2.
 * Each cluster is matched to a profile from its software version (or a per-cluster override), and the
 * portal then knows which operations and fields that cluster's release has, which GUI tab names it uses,
 * and which CLI help applies.
 *
 * How the 5.2 differences were established:
 *   - endpoints a 5.2.14 cluster answered with HTTP 404 during configuration extraction
 *   - the 5.2 vs 5.3 CLI built-in help (commands and options that only exist in 5.3)
 *   - the 5.2 vs 5.3 GUI (Active Directory → Directory Services, Certificates → TLS)
 * Given a 5.2 swagger.json, tools/versions/diff_specs.py generates the exact operation list. */
'use strict';

const VERSIONS = (() => {
  const ANY = '*';
  const r = (m, re) => [m, re];
  const PROFILES = {
    '5.3': { id: '5.3', label: 'Hammerspace 5.3', missingOps: [], missingFields: [], missingParams: [],
      tabTitles: {} },
    '5.2': { id: '5.2', label: 'Hammerspace 5.2',
      // Operations added in 5.3
      missingOps: [
        r(ANY, /^\/name-services/),                       // LDAP name services (Directory Services tab, name-service-config)
        r(ANY, /^\/pki-certificate-authorities/),          // cert-ca-list
        r(ANY, /^\/pki-certificates/),                     // cert-add / cert-list / cert-remove / cert-csr-sign
        r(ANY, /^\/pki-managed-certificates/),
        r(ANY, /^\/nfs-clients$/),
        r('GET', /^\/shares\/mount-details$/),
      ],
      // Body fields added in 5.3 (Schema.field) — hidden in forms and dropped from pushes for 5.2 clusters
      missingFields: [
        'PdClusterView.nfsTransportPolicy',               // cluster-config --nfs-tls-required/--nfs-tls-forbidden
        'SambaAdView.anvilDnsName', 'SambaAdView.portalDnsHostname',   // ad-config --anvil-dns-name/--portal-dns-name
        'IdPView.connectionSecurityType', 'IdPView.validateServerCert',     // idp-add --connection-security/--validate-server-certs-*
        'ObjectStorageVolumeView.storageClass',            // object-volume-add --storage-class
        'ShareView.owningMdsi',                            // share-create --mdsi-*
        'PdSupportView.message',                           // support-bundle --message
      ],
      // Query parameters added in 5.3 (opId:param)
      missingParams: [
        'put:/ad/{identifier}:recreate-nfs-spns',
        'put:/network-interfaces/{identifier}:overrideIpCheck',
        'post:/sw-update/apply/{version}:skipOrderValidation',
      ],
      // GUI tab names used by this release
      tabTitles: { 'admin/ad': 'Active Directory', 'admin/certificates': 'Certificates' } },
  };
  const LATEST = '5.3';
  const ORDER = Object.keys(PROFILES).sort((a, b) => cmp(a, b));
  function cmp(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); return (x[0] - y[0]) || ((x[1] || 0) - (y[1] || 0)); }

  // "5.2.14-1267" -> "5.2"; an unknown or newer release uses the newest profile at or below it
  function forVersion(v) {
    const m = String(v || '').match(/^(\d+)\.(\d+)/);
    if (!m) return PROFILES[LATEST];
    const want = `${m[1]}.${m[2]}`;
    let best = ORDER[0];
    for (const p of ORDER) if (cmp(p, want) <= 0) best = p;
    return PROFILES[cmp(want, ORDER[0]) < 0 ? ORDER[0] : best];
  }
  function forCluster(c) {
    if (!c) return PROFILES[LATEST];
    if (c.apiProfile && PROFILES[c.apiProfile]) return PROFILES[c.apiProfile];
    const st = typeof STATUS !== 'undefined' ? STATUS.get(c.id) : null;
    return forVersion(st?.version || c.version);
  }
  const test = (rules, method, path) => rules.some(([m, re]) => (m === ANY || m === method.toUpperCase()) && re.test(path));
  const opAvailable = (p, method, path) => !test(p.missingOps, method, path);
  const fieldAvailable = (p, schema, field) => !p.missingFields.includes(`${schema}.${field}`);
  const paramAvailable = (p, opId, name) => !p.missingParams.includes(`${opId}:${name}`);
  // the first profile that has an operation (for "Requires 5.3" labels)
  const since = (method, path) => ORDER.find(id => opAvailable(PROFILES[id], method, path)) || LATEST;
  const sinceField = (schema, field) => ORDER.find(id => fieldAvailable(PROFILES[id], schema, field)) || LATEST;
  // drop fields a release doesn't have from a request body (top level of the body schema)
  function stripBody(p, schema, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !p.missingFields.length) return body;
    const out = { ...body };
    for (const f of Object.keys(out)) if (!fieldAvailable(p, schema, f)) delete out[f];
    return out;
  }
  return { PROFILES, LATEST, ORDER, forVersion, forCluster, opAvailable, fieldAvailable, paramAvailable, since, sinceField, stripBody };
})();
