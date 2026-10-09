# Usage: python3 build.py   (after parse.py) -> writes public/cli-docs.js
import json, re, sys, os
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.abspath(os.path.join(HERE,'..','..'))
sys.path.insert(0,HERE)
from map import M, EXTRA_COMMANDS
cli=json.load(open(os.path.join(HERE,'cli.json')))
# Merge the CLI's own built-in help (cli_help.json from parse_help.py), which is current for the cluster it came from.
HELP_PATH=os.path.join(HERE,'cli_help.json')
help_=json.load(open(HELP_PATH)) if os.path.exists(HELP_PATH) else {}
nrm=lambda t: re.sub(r'[^a-z0-9]+',' ',(t or '').lower()).strip()
def best(a,b):
    # a = CLI help text, b = PDF text: keep the one that says more; combine when they differ
    if not a: return b or ''
    if not b: return a
    na,nb=nrm(a),nrm(b)
    if nb in na: return a
    import difflib
    if difflib.SequenceMatcher(None,na,nb).ratio()>=0.8: return a      # same text, different wording/line breaks: the CLI help is current
    if na in nb: return b                                         # the guide repeats the help text and adds more
    return a+'\n(Reference guide: '+b+')'
src={}
for k in set(cli)|set(help_):
    p_=cli.get(k); h_=help_.get(k)
    if p_ and not h_: src[k]='guide'; continue
    if h_ and not p_:
        ch=EXTRA_COMMANDS.get(k,{}).get('chapter','')
        cli[k]={'chapter':ch,'summary':h_['summary'],'options':dict(h_['options'])}; src[k]='help'
    else:
        popts={o:d for o,d in p_['options'].items() if o!='help'}
        extra=set(popts)-set(h_['options'])
        if len(extra)>5: popts={o:d for o,d in popts.items() if o in h_['options']}   # PDF text that ran into the next section
        opts={}
        for o in list(h_['options'])+[o for o in popts if o not in h_['options']]:
            opts[o]=best(h_['options'].get(o), popts.get(o))
        summ=p_['summary']
        if nrm(h_['summary']) not in nrm(summ): summ=h_['summary']+(' '+summ[summ.find('Example'):] if 'Example' in summ else '')
        cli[k]={'chapter':p_['chapter'],'summary':summ,'options':opts}; src[k]='both'
    for o in h_.get('required',[]):
        d=cli[k]['options'].get(o,'')
        if o in cli[k]['options'] and 'Required' not in d: cli[k]['options'][o]=(d+' (Required)').strip()
# commands with no help and no guide entry (added by hand in map.py)
for _k,_v in EXTRA_COMMANDS.items():
    if _k not in cli:
        cli[_k]={'chapter':_v['chapter'],'summary':_v['summary']+' (in the CLI; not documented, so options are not listed here)','options':{}}; src[_k]='manual'
S=json.load(open(os.path.join(ROOT,'public','swagger.json')))
D=S['definitions']
def ref(s): return s['$ref'].split('/')[-1] if s and '$ref' in s else None
def props(name, seen=None):
    d=D.get(name,{}); out=dict(d.get('properties',{}))
    for a in d.get('allOf',[]):
        if ref(a): out.update(props(ref(a)))
        out.update(a.get('properties',{}))
    return out
norm=lambda s: re.sub(r'[^a-z0-9]','',s.lower())
SUFFIX=re.compile(r'-(clear|add|remove|update|delete|enable|disable|set)$')
ALIAS={  # option base -> field names
 'availability':['availability','storageCapabilities','expression'],'durability':['durability','storageCapabilities','expression'],
 'high-threshold':['highThreshold','storageCapabilities'],'low-threshold':['lowThreshold','storageCapabilities'],'online-delay':['storageCapabilities'],
 'read-bandwidth':['storageCapabilities'],'read-iops':['storageCapabilities'],'read-latency':['storageCapabilities'],'write-bandwidth':['storageCapabilities'],
 'write-iops':['storageCapabilities'],'write-latency':['storageCapabilities'],'tolerable-read-latency':['storageCapabilities'],'tolerable-write-latency':['storageCapabilities'],
 'availability-drop':['storageCapabilities'],'availability-drop-enabled':['storageCapabilities'],'availability-drop-disabled':['storageCapabilities'],
 'exclude-free-space':['excludeFromClusterCapacityFreeSpace'],'stripe-alignment':['stripeAlignmentBytes'],'stripe-alignment-default':['stripeAlignmentBytes'],
 'random-writes':['allowsRandomWrites'],'random-writes-disabled':['allowsRandomWrites'],'random-writes-enabled':['allowsRandomWrites'],
 'realign-on-protection-drop':['realignOnProtectionDrop'],'realign-on-protection-drop-disabled':['realignOnProtectionDrop'],'realign-on-protection-drop-enabled':['realignOnProtectionDrop'],
 'assimilation':['assimilationSpec'],'log-assimilation':['assimilationSpec'],'source-path':['assimilationSpec','source-path'],'destination-path':['assimilationSpec','destination-path'],
 'smb-path':['assimilationSpec'],'smb-username':['assimilationSpec'],'smb-password':['assimilationSpec'],'smb-default-user':['assimilationSpec'],'smb-default-group':['assimilationSpec'],
 'skip-file-access-test':['assimilationSpec','skipFileAccessTest'],'node-id':['logicalVolume','node'],
 'use-high-compression':['compressionType'],'use-default-encryption':['kms'],'no-encryption':['kms'],'native':['osvNamingType'],
 'offloaded-cloning':['storageCapabilities'],'enable-offloaded-cloning':['storageCapabilities'],'disable-offloaded-cloning':['storageCapabilities'],
 'proxy-host':['proxyInfo'],'proxy-port':['proxyInfo'],'proxy-username':['proxyInfo'],'proxy-password':['proxyInfo'],'proxy':['proxyInfo'],
 'bucket-naming-virtual-host':['useVirtualHostNaming'],'bucket-naming-path-style':['useVirtualHostNaming'],
 'allow-self-signed-certificate':['trustCertificate'],'disallow-self-signed-certificate':['trustCertificate'],'cert':['trustCertificate'],
 'security-token':['mgmtNodeCredentials'],'aws-instance-profile-auth':['mgmtNodeCredentials'],'additional-info':['extraData'],
 'remote-share-name':['addSpec'],'remote-share-path':['addSpec'],'site-address':['addSpec','removeSpec'],'site-username':['addSpec'],'site-password':['addSpec'],
 'skip-participant-validations':['skipGfsValidation'],'participant-id':['participantId','removeSpec'],
 'from-date':['start','spec'],'until-date':['end','spec'],'cleared':['spec'],'uncleared':['spec'],'severity':['spec'],'last-emitted':['spec'],
 'created-after':['spec'],'created-before':['spec'],'ended-after':['spec'],'ended-before':['spec'],'started-after':['spec'],'started-before':['spec'],'last-created':['spec'],'status':['spec'],
 'interface-name':['identifier'],'interface-id':['identifier'],'filename':['filePath','filename-expression','filename'],
 'new-password':['password','newPassword','body'],'old-password':['oldPassword'],'no-idle-timeout':['idleTimeoutSeconds'],
 'contact':['sysContact'],'location':['sysLocation'],'manager':['snmpManagers'],'dest':['snmpTrapDests'],
 'path':['export-path','path'],'reason':['reason'],
 'referral-address':['referral'],'referral-path':['referral'],'size-warning-threshold':['warnUtilizationPercentThreshold'],'smb-browsable':['smbBrowsable'],'smb-browsable-off':['smbBrowsable'],'smb-browsable-on':['smbBrowsable'],
 'allowed-online-delay':['expression'],'archive':['expression'],'confine-to':['expression'],'do-not-move':['expression'],'exclude-from':['expression'],
 'max-read-response-time':['expression','readPerformance'],'max-write-response-time':['expression','writePerformance'],'min-read-iops':['expression','readPerformance'],'min-read-throughput':['expression','readPerformance'],
 'min-write-iops':['expression','writePerformance'],'min-write-throughput':['expression','writePerformance'],'optimize-for-capacity':['expression'],'place-on-list':['expression','placementObjective'],
 'minute':['cronExpression'],'hour':['cronExpression'],'day-of-month':['cronExpression'],'day-of-week':['cronExpression'],'month':['cronExpression'],
 'client-certificate':['credentials'],'client-private-key':['credentials'],'passphrase':['credentials'],'server-certificate-chain':['credentials','serverCertChain'],'add-passphrase':['credentials'],
 'capacity':['requestedLicenseCount','allocatedCapacity','licenseCount'],'mgmt-address':['address','mgmtAddress'],'trust-client-certificate':['trustClientCert'],'no-trust-client-certificate':['trustClientCert'],
 'override-mgmt-address':['overrideMgmtAddress'],'override-data-address':['overrideDataAddress'],'data-center':['physicalLocation'],'geo-coordinates':['physicalLocation'],'latitude':['physicalLocation'],'longitude':['physicalLocation'],'plus-code':['physicalLocation'],
 'address':['networkEndpoints','address'],'transport-mode':['ldapTransport'],'schema':['ldapSchema'],'resolution-order':['ordinal'],'no-connection-test':['skipConnectionTest'],'bind-dn':['bindDn'],'bind-secret':['bindSecret'],'search-base':['searchBase'],
 'from':['mapFrom','from'],'to':['mapTo','to'],'order':['priority'],'inherit-from':['inheritFrom'],'no-inherit-from':['inheritFrom'],'inherit-to':['inheritTo'],'no-inherit-to':['inheritTo'],
 'create-homedir':['createHomeDir'],'multichannel':['multiChannelEnabled'],'min-smb-client':['minSmbClient'],'distributed-lock-manager':['distributedLockManagerEnabled'],
 'autohome':['smbAutohomeEnabled'],'autohome-enable':['smbAutohomeEnabled'],'autohome-disable':['smbAutohomeEnabled'],'default':['isDefault'],
 'ad-servers':['adServers'],'computer-ou':['computerOu'],'dns-configured-ips':['dnsConfiguredIps'],'dns-configured-ip':['dnsConfiguredIps'],'dns-auto-register-floating-ips':['registerAllFloatingIps'],
 'id-mapping-domains':['providedIdMappingDomains'],'identity-mapping-schema':['ldapSchema'],'remove-computer':['removeComputer'],'portal-dns-name':['portalDnsHostname'],'anvil-dns-name':['anvilDnsName'],'join':['joined'],'leave':['joined'],
 'ip':['volume-ip','ipAddresses','mgmtIpAddress','address','ip'],'cluster':['clusterFloatingIps'],'portal':['portalFloatingIps'],
 'server-certificate-reset':['resetServerCert'],'server-private-key':['serverPrivateKey'],'timezone':['timezone'],
 'group':['groupname','group'],'task-id':['identifier','taskId'],'connect-timeout':['connectTimeoutSeconds'],'read-timeout':['readTimeoutSeconds'],
 'validate-server-certs':['validateServerCert'],'follow-referrals':['followReferrals'],'ignore-referrals':['followReferrals'],
 'pem':['body'],'trust-intermediate-ca':['trustIntermediateCa'],'trust-self-signed-certificate':['trustSelfSignedCertificate'],
 'node':['node'],'push':['push'],'message':['extra'],

}
ALIAS_OLD={
 'description':['sysDescription','description','comment'],'objective':['shareObjectives'],'applied-objective':['appliedObjectives','objectives'],
 'size':['shareSizeLimit'],'size-limit':['shareSizeLimit'],'export-option':['exportOptions'],
 'mgmt-role-name':['managementRole'],'mgmt-role-id':['managementRole'],'data-access-role':['dataAccessRoles','roles'],
 'first-name':['firstName'],'last-name':['lastName'],'public-key':['publicKey','publicKeys'],
 'ip':['ipAddresses','mgmtIpAddress','address','ip'],'node-name':['node','nodeName'],'roles':['roles'],
 'servers':['servers','adServers'],'server':['syslogServers','servers'],'type':['type','nodeType','kmsType','idpType','heartbeatType','licenseType','payloadType'],
 'threshold':['threshold'],'new-threshold':['threshold'],'new-format':['format'],'format':['format'],'users':['users'],
 'retention-time':['retentionTime'],'number-of-copies':['numOfCopies','numberOfCopies'],
 'schedule-name':['schedule'],'retention-name':['retention'],'new-retention-name':['retention'],
 'connection-security':['connectionSecurityType','connectionSecurity'],'from-address':['fromAddress'],
 'host':['host'],'port':['port'],'password':['password'],'username':['username'],
 'acl':['acl','permissions'],'idle-timeout':['idleTimeoutSeconds','idleTimeout'],
 'allowed-networks':['allowedNetworks'],'lock-after-failures':['lockAfterFailures'],'lock-failure-interval':['lockFailureInterval'],'lockout-time':['lockoutTime'],
 'expressions':['expressions','volumeGroupExpressions'],'group':['group'],'interval':['intervalSecs','interval','updateInterval'],
 'mgmt-address':['mgmtAddress'],'override-mgmt-address':['overrideMgmtAddress'],'override-data-address':['overrideDataAddress'],
 'trust-client-certificate':['trustClientCertificate'],'geo-coordinates':['geoCoordinates'],'data-center':['dataCenter'],
 'endpoint':['endpoint'],'access-id':['accessId','mgmtNodeCredentials'],'secret':['secret','mgmtNodeCredentials'],
 'proxy-url':['proxyUri'],'prometheus-exporters':['prometheusEnabled'],'gfs-participant-max-suspected-time':['gfsParticipantMaxSuspectedSec'],
 'online-activation-support':['onlineLicenseActivationSupport'],'nfs-tls-required':['nfsTransportPolicy'],'nfs-tls-forbidden':['nfsTransportPolicy'],
 'mtu':['mtu'],'vlan-id':['vlanId','vlan'],'ipv4':['ipv4'],'ipv6':['ipv6'],'destination':['destination'],'next-hop':['nextHop','gateway'],
 'gateway':['gateway'],'subnet':['subnet'],'contact':['contact'],'location':['location'],'manager':['managers','manager'],'dest':['trapDestinations','destinations'],
 'high-threshold':['highThreshold'],'low-threshold':['lowThreshold'],'max-suspected-time':['maxSuspectedSeconds'],
 'availability':['availability'],'durability':['durability'],'access-type':['accessType'],'cost':['cost'],
 'native':['native'],'no-compression':['compressionType'],'no-encryption':['encryption','encrypted'],
 'logical-volume-name':['objectStoreLogicalVolume','logicalVolume'],'logical-volume-id':['objectStoreLogicalVolume','logicalVolume'],
 'access-key':['accessKey'],'secret-key':['secretKey'],'max-keys':['maxKeys'],'ports':['ports'],'endpoints':['endpoints'],'region':['region'],
 'default-server':['defaultServer'],'endpoint-prefix':['endpointPrefix'],'umask':['umask'],'identity-provider':['identityProvider'],
 'mpu-abort-threshold-days':['mpuAbortThresholdDays'],'strict-bucket-naming':['strictBucketNaming'],'strict-bucket-listing':['strictBucketListing'],
 'domain':['domain','domainName'],'realm':['domain'],'from':['from'],'to':['to'],'attribute':['attribute'],'order':['order'],'bidirectional':['bidirectional'],
 'additional-ip':['additionalIpAddresses','additionalAddresses'],'excluded-ip':['excludedIpAddresses'],'exclude-free-space':['excludeFreeSpace'],
 'gid':['gid'],'uid':['uid'],'email':['email'],'enable':['enabled'],'disable':['enabled'],
}
for k,v in ALIAS_OLD.items(): ALIAS[k]=ALIAS.get(k,[])+[x for x in v if x not in ALIAS.get(k,[])]
def opid(s): m,p=s.split(' ',1); return m.lower()+':'+p
def candidates(opt):
    base=SUFFIX.sub('',opt); base=re.sub(r'^new-','',base)
    c=ALIAS.get(opt,[])+ALIAS.get(base,[])
    camel=re.sub(r'-([a-z0-9])',lambda m:m.group(1).upper(),base)
    c+=[camel, camel+'s', camel+'es', camel[:-1] if camel.endswith('s') else camel, camel+'Enabled', 'is'+camel[0].upper()+camel[1:]]
    return base, c
fields={}   # 'Schema.field' -> [cmd,opt]
params={}   # opid -> {param: [cmd,opt]}
ops={}      # opid -> [cmd]
stats={'opts':0,'mapped':0}; unmapped={}; mapped_any=set()
SKIP={'async','no-timeout','full','view','help','force-master-acquisition'}
for cmd,ol in M.items():
    info=cli[cmd]
    for o in ol:
        oid=opid(o); ops.setdefault(oid,[]).append(cmd)
        m,p=o.split(' ',1); op=S['paths'][p][m.lower()]
        prm=op.get('parameters',[])+S['paths'][p].get('parameters',[])
        body=next((x for x in prm if x.get('in')=='body'),None)
        bname=ref(body.get('schema')) if body else None
        if body and not bname and body.get('schema',{}).get('items'): bname=ref(body['schema']['items'])
        if bname in (None,'BaseEntityView') and body:
            twin=S['paths'][p].get('get') or S['paths'].get(re.sub(r'/\{[^}]+\}$','',p),{}).get('get')
            if twin:
                rs=twin.get('responses',{}).get('200',{}).get('schema',{})
                bname=ref(rs) or ref(rs.get('items')) or bname
        bprops=props(bname) if bname else {}
        pmap={norm(x['name']):x['name'] for x in prm if x.get('in') in ('path','query','formData')}
        fmap={norm(k):k for k in bprops}
        for opt,desc in info['options'].items():
            if opt in SKIP: continue
            stats['opts']+=1
            base,cands=candidates(opt); hit=False
            mo=re.match(r'^(share|server|site|node|snapshot|dsx|enclosure)-(id|internal-id|name)$',opt)
            if mo:
                for cand in (mo.group(1)+'-identifier','identifier' if mo.group(1)=='server' else None, mo.group(1)):
                    if cand and norm(cand) in pmap: params.setdefault(oid,{}).setdefault(pmap[norm(cand)],[cmd,opt]); hit=True; break
            if opt in ('id','internal-id','name') and 'identifier' in pmap.values():
                params.setdefault(oid,{}).setdefault('identifier',[cmd,opt]); hit=True; mapped_any.add((cmd,opt))
                if opt!='name' or not bprops: continue
            for c in cands:
                n=norm(c)
                if n in pmap:
                    params.setdefault(oid,{}).setdefault(pmap[n],[cmd,opt]); hit=True; break
            for c in cands:
                n=norm(c)
                if n in fmap:
                    k=f'{bname}.{fmap[n]}'
                    lst=fields.setdefault(k,[])
                    b0=SUFFIX.sub('',opt)
                    if not any(SUFFIX.sub('',o)==b0 for c0,o in lst): lst.append([cmd,opt])
                    elif not SUFFIX.search(opt):   # prefer the plain option over -add/-clear variants
                        for e in lst:
                            if SUFFIX.sub('',e[1])==b0 and SUFFIX.search(e[1]): e[0],e[1]=cmd,opt
                    hit=True; break
            if hit: mapped_any.add((cmd,opt))
allopts={(c,o) for c,v in cli.items() for o in v['options'] if o not in SKIP and c in M}
um=sorted(allopts-mapped_any); print('options',len(allopts),'mapped',len(mapped_any),'fields',len(fields),'params',sum(len(v) for v in params.values()))
import collections; g=collections.defaultdict(list)
for c,o in um: g[c].append(o)
for c,v in g.items(): print(c, v)
cmds={}
for k,v in cli.items():
    summ=v['summary']; ex=''
    mm=re.search(r'\bExamples?\b:?\s+('+re.escape(k)+r'\b.*)$', summ)
    if mm: ex=mm.group(1); summ=summ[:mm.start()].strip()
    cmds[k]={'chapter':v['chapter'],'summary':summ,'example':ex,'source':src.get(k,'guide'),'options':{o:d for o,d in v['options'].items() if o!='help'}}
out={'version':'5.3','sources':{'guide':'Hammerspace 5.3 Command Line Reference','help':'the CLI’s built-in help','both':'the CLI’s built-in help and the 5.3 Command Line Reference','manual':'confirmed by users'},'commands':cmds,'ops':ops,'fields':fields,'params':params}
open(os.path.join(ROOT,'public','cli-docs.js'),'w').write(
 "/* Generated from the Hammerspace 5.3 Command Line Reference (2026-10-07): CLI commands, their options, and how they map to API operations and fields.\n * Regenerate with tools/cli-docs (see its README). */\n'use strict';\nconst CLI_DOCS = "+json.dumps(out,ensure_ascii=False,separators=(',',':'))+";\n")
