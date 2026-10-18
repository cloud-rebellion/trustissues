export interface Guide {
  slug: string;
  file: string;
  title: string;
  description: string;
  group: 'Start here' | 'Reference' | 'Operations';
  topics: string;
}

export const guides: Guide[] = [
  {
    slug: 'user-guide',
    file: 'docs/USER-GUIDE.md',
    title: 'Using TrustIssues',
    description:
      'Create vaults, add credentials, share with clients, and move from Proton Pass.',
    group: 'Start here',
    topics:
      'personal password login custom fields import export pgp proton csv sharing delete unlock clipboard health',
  },
  {
    slug: 'administration',
    file: 'docs/ADMIN-GUIDE.md',
    title: 'Accounts and administration',
    description:
      'Understand roles, onboard clients, enable MFA, and manage rotation and auditing.',
    group: 'Start here',
    topics:
      'permissions viewer editor manager invitations clients users totp mfa 2fa extension api keys rotation providers smtp alerts sessions ownership activity',
  },
  {
    slug: 'security-and-automation',
    file: 'docs/SECURITY-AND-AUTOMATION-GUIDE.md',
    title: 'Security and AI automation',
    description:
      'How encryption, IDE connections, credential injection, and service identities work.',
    group: 'Start here',
    topics:
      'ide ai mcp shield capability proxy destinations encryption passphrase keys service identity private vpn tailscale',
  },
  {
    slug: 'pgp',
    file: 'docs/PGP-IMPORT-EXPORT.md',
    title: 'PGP and Proton Pass',
    description:
      'Supported encrypted formats, migration mappings, keys, and size limits.',
    group: 'Reference',
    topics:
      'import export proton csv json zip asc gpg pgp passphrase private public key',
  },
  {
    slug: 'portability',
    file: 'docs/PORTABILITY.md',
    title: 'Vault portability',
    description:
      'What exports contain and which content and permissions transfer on import.',
    group: 'Reference',
    topics:
      'native json conflicts duplicates migration membership export scope',
  },
  {
    slug: 'backup',
    file: 'docs/BACKUP.md',
    title: 'Backup and recovery',
    description:
      'Consistent database snapshots and verified restores with separate key custody.',
    group: 'Operations',
    topics: 'restore disaster recovery snapshot database sqlite wal encryption',
  },
  {
    slug: 'private-ingress',
    file: 'docs/PRIVATE-INGRESS.md',
    title: 'Private network access',
    description: 'Configure the private URL and protected vault policies.',
    group: 'Operations',
    topics:
      'tailscale headscale vpn socket caddy network public private ingress',
  },
  {
    slug: 'admin-recovery',
    file: 'docs/ADMIN-LOCKOUT-RECOVERY.md',
    title: 'Administrator lockout',
    description:
      'Operator recovery when normal administrator sign-in is unavailable.',
    group: 'Operations',
    topics: 'mfa totp lost password recovery codes lockout',
  },
  {
    slug: 'security-policy',
    file: 'SECURITY.md',
    title: 'Security policy',
    description: 'Encryption, key rotation, and responsible reporting.',
    group: 'Reference',
    topics: 'vulnerability key encryption reporting security',
  },
  {
    slug: 'threat-model',
    file: 'THREAT-MODEL.md',
    title: 'Threat model',
    description: 'Trust boundaries, defenses, and known limitations.',
    group: 'Reference',
    topics: 'risks zero knowledge server root host trust csrf xss capability',
  },
  {
    slug: 'project',
    file: 'README.md',
    title: 'Deployment and API reference',
    description:
      'Self-hosting, configuration, provider routes, and extension setup.',
    group: 'Operations',
    topics: 'install docker environment api gateway provider routes extension',
  },
  {
    slug: 'architecture',
    file: 'CONTRACT.md',
    title: 'Architecture contract',
    description: 'Backend architecture and development constraints.',
    group: 'Reference',
    topics: 'development backend api architecture',
  },
  {
    slug: 'frontend',
    file: 'FRONTEND-CONTRACT.md',
    title: 'Frontend contract',
    description: 'Frontend architecture and behavior contracts.',
    group: 'Reference',
    topics: 'development frontend react browser',
  },
  {
    slug: 'contributing',
    file: 'CONTRIBUTING.md',
    title: 'Contributing',
    description: 'Build, test, and contribution workflow.',
    group: 'Reference',
    topics: 'development build test contribute',
  },
  {
    slug: 'deferred',
    file: 'DEFERRED.md',
    title: 'Deferred functionality',
    description:
      'Features and operational work explicitly deferred by the project.',
    group: 'Reference',
    topics: 'roadmap future limitations deferred',
  },
  {
    slug: 'index',
    file: 'docs/README.md',
    title: 'Documentation index',
    description: 'All guides and focused runbooks in one place.',
    group: 'Reference',
    topics: 'guides documentation index',
  },
  {
    slug: 'screenshots',
    file: 'docs/screenshots/user-guide/README.md',
    title: 'About the screenshots',
    description: 'Synthetic data, source release, and screenshot provenance.',
    group: 'Reference',
    topics: 'screenshots examples demo synthetic images',
  },
];

export const guidePath = (slug: string) => `/documentation/${slug}`;
export const documentationAsset = (file: string) =>
  `/api/documentation/${file.split('/').map(encodeURIComponent).join('/')}`;

export function findGuides(query: string): Guide[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return guides.filter((guide) =>
    words.every((word) =>
      `${guide.title} ${guide.description} ${guide.topics}`
        .toLowerCase()
        .includes(word),
    ),
  );
}

const imagePattern =
  /^docs\/screenshots\/user-guide\/(?:0[1-9]|1[0-6])-[a-z-]+\.png$/;
function localFile(
  currentFile: string,
  href: string,
): { file: string; hash: string } | undefined {
  try {
    const resolved = new URL(
      href,
      `https://documentation.invalid/${currentFile}`,
    );
    if (resolved.origin !== 'https://documentation.invalid') return;
    return {
      file: decodeURIComponent(resolved.pathname.slice(1)),
      hash: resolved.hash,
    };
  } catch {
    return;
  }
}

export function resolveGuideLink(
  currentFile: string,
  href: string,
): string | undefined {
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  const local = localFile(currentFile, href);
  if (!local) return;
  const guide = guides.find((item) => item.file === local.file);
  if (guide) return guidePath(guide.slug) + local.hash;
  if (
    imagePattern.test(local.file) ||
    local.file === 'docs/screenshots/user-guide/manifest.json'
  )
    return documentationAsset(local.file);
}

export function resolveGuideImage(
  currentFile: string,
  src: string,
): string | undefined {
  const local = localFile(currentFile, src);
  return local && imagePattern.test(local.file)
    ? documentationAsset(local.file)
    : undefined;
}

export interface GuideHeading {
  id: string;
  title: string;
  depth: number;
}
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s/g, '-');
}

export function guideHeadings(content: string): GuideHeading[] {
  const result: GuideHeading[] = [];
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const title = match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*`]/g, '');
    const base = headingSlug(title);
    const number = seen.get(base) ?? 0;
    seen.set(base, number + 1);
    result.push({
      id: base + (number ? `-${number}` : ''),
      title,
      depth: match[1].length,
    });
  }
  return result;
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown> };
}
export function remarkHeadingIds() {
  return (tree: MarkdownNode) => {
    const seen = new Map<string, number>();
    const text = (node: MarkdownNode): string =>
      node.value ?? node.children?.map(text).join('') ?? '';
    const visit = (node: MarkdownNode) => {
      if (node.type === 'heading') {
        const base = headingSlug(text(node));
        const number = seen.get(base) ?? 0;
        seen.set(base, number + 1);
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            id: base + (number ? `-${number}` : ''),
          },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
