import { useEffect, useState } from 'react';
import { Github } from 'lucide-react';
import { getApiConfig, type LegalUrlsConfig } from '@/config/api';
import { SUPPORT_MAILTO } from '@/lib/support';

// Subtle "view source" icon link rendered at the end of the legal row
// when `Revdoku.source_code_url` is configured. Wrapped in a <span>
// with a leading dot separator so the legal row reads as one continuous
// list.
function GithubIconLink({ href }: { href: string }) {
  return (
    <span>
      <span className="mx-1">&middot;</span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View source on GitHub"
        title="View source on GitHub"
        className="inline-flex items-center align-middle hover:text-foreground transition-colors"
      >
        <Github className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}

export function LegalLinks() {
  const [legal, setLegal] = useState<LegalUrlsConfig | null>(null);

  useEffect(() => {
    getApiConfig()
      .then(cfg => setLegal(cfg.legal ?? {}))
      .catch(() => setLegal({}));
  }, []);

  if (legal === null) return null;

  const links: Array<{ href: string; label: string }> = [];
  if (legal.terms)   links.push({ href: legal.terms,   label: 'Terms' });
  if (legal.privacy) links.push({ href: legal.privacy, label: 'Privacy' });
  links.push({ href: SUPPORT_MAILTO, label: 'Contact Us' });

  // No policy URLs configured — fall back to an open-source attribution.
  // "Contact Us" is always present so users can still reach the operator.
  // The explicit text framing here ("Running Revdoku Open Source — host")
  // is more useful than the icon alone for self-hosters who haven't set
  // their own legal links yet, so we keep the long form on this branch.
  if (links.length === 1 && legal.source_code) {
    const displayHost = legal.source_code.replace(/^https?:\/\//, '');
    return (
      <>
        <span>
          Running Revdoku Open Source &mdash;{' '}
          <a
            href={legal.source_code}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            {displayHost}
          </a>
        </span>
        <span className="mx-1">&middot;</span>
        <a
          href={SUPPORT_MAILTO}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Contact Us
        </a>
      </>
    );
  }

  return (
    <>
      {links.map((link, i) => (
        <span key={link.href}>
          {i > 0 && <span className="mx-1">&middot;</span>}
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            {link.label}
          </a>
        </span>
      ))}
      {legal.source_code && <GithubIconLink href={legal.source_code} />}
    </>
  );
}
