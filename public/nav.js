/* Navigation model that mirrors the Hammerspace management GUI.
 * Each operation is placed on the GUI page/tab where it is used. Anything the GUI does not expose
 * lands in "CLI Only or Hidden APIs", grouped by API tag.
 * Rules are [METHOD|'*', pathRegex]; the first matching tab wins. HIDDEN rules are checked first.
 * Edit this file to move an API between sections — nothing else needs to change. */
'use strict';

const NAV = (() => {
  const r = (m, re) => [m, re];
  const ANY = '*';

  // Operations listed under "CLI Only or Hidden APIs" (not shown in the GUI and not grouped elsewhere)
  const HIDDEN = [
    r(ANY, /^\/sw-update\/\{identifier\}\/cancel$/),
    r(ANY, /^\/cntl\/(shutdown|accept-eula|state)$/),
    r(ANY, /^\/reports\/mobility\/share$/), r(ANY, /^\/login$/),
  ];
  // Operations grouped with a GUI section but not shown in the GUI (flagged "not in GUI"). Add rules here if needed.
  const NOT_IN_GUI = [];

  const SECTIONS = [
    { id: 'dashboard', title: 'Dashboard', icon: 'home', tabs: [
      { id: 'performance', title: 'Performance', rules: [r('GET', /^\/reports\/stats\/(performance|metadata)\//)] },
      { id: 'capacity', title: 'Capacity', rules: [r('GET', /^\/reports\/stats\/space\//), r('GET', /^\/metrics\/capacity\//), r('GET', /^\/system\/counts$/)] },
      { id: 'gfs', title: 'GFS & Cross-Site Traffic', rules: [r('GET', /^\/reports\/mobility\/replications/)] },
      { id: 'health', title: 'Health', rules: [r('GET', /^\/system\/health$/)] },
      { id: 'alignment', title: 'Alignment', rules: [r('GET', /^\/reports\/stats\/alignment\//)] },
      { id: 'reasons', title: 'Mobility Reasons', rules: [r('GET', /^\/reports\/mobility\/summary$/)] },
    ] },
    { id: 'mobility', title: 'Mobility', icon: 'shuffle', tabs: [
      { id: 'across', title: 'Mobility Across Volumes', rules: [r('GET', /^\/reports\/mobility$/)] },
    ] },
    { id: 'data', title: 'Data', icon: 'folders', tabs: [
      { id: 'shares', title: 'Shares', rules: [r(ANY, /^\/shares/), r(ANY, /^\/share-participants/), r(ANY, /^\/share-replications/)] },
      { id: 'files', title: 'Files', rules: [r(ANY, /^\/files/)] },
      { id: 'snapshots', title: 'Share Snapshots', rules: [r(ANY, /^\/share-snapshots/), r(ANY, /^\/schedules/), r(ANY, /^\/snapshot-retentions/)] },
      { id: 'buckets', title: 'Buckets & Bucket Containers', rules: [r(ANY, /^\/s3server\/\{identifier\}\/(bucket|listBuckets)$/)] },
      { id: 'file-snapshots', title: 'File Snapshots', rules: [r(ANY, /^\/file-snapshots/)] },
      { id: 'data-copy', title: 'Data Copy to Object', rules: [r(ANY, /^\/data-copy-to-object/)] },
    ] },
    { id: 'objectives', title: 'Objectives', icon: 'target', tabs: [
      { id: 'objectives', title: 'Objectives', rules: [r(ANY, /^\/objectives/)] },
      { id: 'profiler', title: 'Data Profiler', rules: [r(ANY, /^\/modeler\//)] },
    ] },
    { id: 'infrastructure', title: 'Infrastructure', icon: 'storage', tabs: [
      { id: 'volumes', title: 'Volumes', rules: [r(ANY, /^\/storage-volumes/), r(ANY, /^\/object-storage-volumes/), r(ANY, /^\/base-storage-volumes/),
        r(ANY, /^\/logical-volumes/), r(ANY, /^\/object-store-logical-volumes/)] },
      { id: 'volume-groups', title: 'Volume Groups', rules: [r(ANY, /^\/volume-groups/)] },
      { id: 'storage-systems', title: 'Storage Systems', rules: [r(ANY, /^\/nodes/)] },
      { id: 'nvmeof', title: 'NVMe-oF Enclosures', rules: [r(ANY, /^\/nvmeof-enclosures/)] },
    ] },
    { id: 'admin', title: 'Administration', icon: 'gear', tabs: [
      { id: 'system', title: 'System', rules: [r(ANY, /^\/cntl/), r(ANY, /^\/disk-drives/), r('GET', /^\/sites\/local$/), r(ANY, /^\/system\/ping$/)] },
      { id: 'services', title: 'Services', rules: [r(ANY, /^\/data-portals/)] },
      { id: 'network', title: 'Network', rules: [r(ANY, /^\/network-interfaces/)], also: ['put:/cntl/{identifier}'],
        note: 'Floating IPs are part of the cluster settings — use “Update Cluster” (portalFloatingIps / clusterFloatingIps).' },
      { id: 's3', title: 'S3 Servers', rules: [r(ANY, /^\/s3server/)] },
      { id: 'sites', title: 'Sites', rules: [r(ANY, /^\/sites/)] },
      { id: 'snmp', title: 'SNMP', rules: [r(ANY, /^\/snmp/)] },
      { id: 'software', title: 'Software Update', rules: [r(ANY, /^\/versions/), r(ANY, /^\/sw-update/)] },
      { id: 'support', title: 'Support', rules: [r(ANY, /^\/pd-support/)] },
      { id: 'ad', title: 'Active Directory', rules: [r(ANY, /^\/ad(\/|$)/)] },
      { id: 'users', title: 'Users', rules: [r(ANY, /^\/users/)] },
      { id: 'licenses', title: 'Licenses', rules: [r(ANY, /^\/licenses/)] },
      { id: 'backup', title: 'System Backup', rules: [r(ANY, /^\/backup/)] },
      { id: 'certificates', title: 'Certificates', rules: [], also: ['get:/cntl/{identifier}', 'put:/cntl/{identifier}'],
        note: 'The cluster certificate is part of the cluster settings: “Update Cluster” with serverCertChain / serverPrivateKey, or resetServerCert to go back to the default.' },
      { id: 'smb', title: 'SMB', rules: [r(ANY, /^\/smbautohomes/)], also: ['put:/ad/{identifier}'],
        note: 'Multichannel and the auto-home switch are Active Directory settings (multiChannelEnabled, smbAutohomeEnabled).' },
    ] },
    { id: 'header', title: 'Notifications & Tasks', icon: 'bell', tabs: [
      { id: 'events', title: 'Notifications', rules: [r(ANY, /^\/events/)] },
      { id: 'tasks', title: 'Tasks', rules: [r(ANY, /^\/tasks/)] },
    ] },
  ];

  const HIDDEN_SECTION = { id: 'hidden', title: 'CLI Only or Hidden APIs', icon: 'terminal' };

  const test = (rules, method, path) => rules.some(([m, re]) => (m === ANY || m === method) && re.test(path));

  function classify(method, path) {
    const M = method.toUpperCase();
    if (!test(HIDDEN, M, path)) {
      for (const s of SECTIONS) for (const t of s.tabs) if (test(t.rules, M, path)) return { section: s.id, tab: t.id, notInGui: test(NOT_IN_GUI, M, path) };
    }
    return { section: 'hidden', tab: null, notInGui: true };
  }

  const section = id => id === 'hidden' ? HIDDEN_SECTION : SECTIONS.find(s => s.id === id);
  const tab = (sid, tid) => section(sid)?.tabs?.find(t => t.id === tid);

  // Inline SVG icons (simple originals)
  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    shuffle: '<path d="M3 7h4l10 10h4M3 17h4l3-3m4-4 3-3h4M18 4l3 3-3 3M18 14l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    folders: '<path d="M2 6a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v1H6.5a1 1 0 0 0-1 .8L4 17H3a1 1 0 0 1-1-1z"/><path d="M7 10h14a1 1 0 0 1 1 1.2l-1.4 7a1 1 0 0 1-1 .8H5.3a.5.5 0 0 1-.5-.6l1.5-7.6A1 1 0 0 1 7 10z"/>',
    target: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.8"/>',
    storage: '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 8.2c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V12c0 1.5-3.6 2.8-8 2.8S4 13.5 4 12z"/><path d="M4 15.7c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v3c0 1.5-3.6 2.8-8 2.8s-8-1.3-8-2.8z"/>',
    gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    bell: '<path d="M12 3a6 6 0 0 0-6 6v4l-2 3v1h16v-1l-2-3V9a6 6 0 0 0-6-6zm-2 16a2 2 0 0 0 4 0z"/>',
    terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m6.5 9 3.5 3-3.5 3M12 16h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    clusters: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1" fill="#fff"/><circle cx="7" cy="17" r="1" fill="#fff"/>',
    report: '<path d="M6 2h9l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 1.5V8h4.5M8 12h8M8 15.5h8M8 19h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    audit: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="18" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4.5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  };
  const icon = (name, size = 20) => `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  return { SECTIONS, HIDDEN_SECTION, classify, section, tab, icon };
})();
